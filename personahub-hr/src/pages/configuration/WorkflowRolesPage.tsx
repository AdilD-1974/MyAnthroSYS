import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { Users, Plus, Pencil, Save, Loader2, X, Power, Trash2, UserPlus, Search } from "lucide-react";
import { useWorkflowRolesData, saveRoleMembres, WfRole, WfRoleMembre, OptionLite, UoNode, CATEGORIES_ROLE } from "@/hooks/useWorkflowRoles";

const CAT_COLOR: Record<string, string> = { DIRECTION: "#8B5CF6", RH: "#3B6FE4", MANAGEMENT: "#E07B39", FINANCE: "#14B8A6", GENERAL: "#64748B" };
const catColor = (c: string) => CAT_COLOR[c] || "#64748B";

interface Draft extends WfRole { membres: WfRoleMembre[]; }
const emptyDraft = (ordre: number): Draft => ({ id: "", code: "", libelle: "", description: "", categorie: "GENERAL", couleur: "", actif: true, ordre, membres: [] });

export default function WorkflowRolesPage() {
  const qc = useQueryClient();
  const { roles, membresByRole, collaborateurs, postes, uoHier, collabLabel, posteLabel, loading, refetch } = useWorkflowRolesData();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ i: number; kind: "collaborateur" | "poste" } | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["wf-roles-data"] });
  const openNew = () => setDraft(emptyDraft((roles.at(-1)?.ordre ?? 0) + 1));
  const openEdit = (r: WfRole) => setDraft({ ...r, description: r.description || "", couleur: r.couleur || "",
    membres: (membresByRole[r.id] || []).map((m: any) => ({ id: m.id, cible: m.poste_code ? "poste" : "collaborateur", collaborateur_id: m.collaborateur_id, poste_code: m.poste_code, unite_id: m.unite_id, date_debut: m.date_debut, date_fin: m.date_fin, actif: m.actif } as any)) });

  const toggleActif = async (r: WfRole) => {
    setBusy(r.id);
    try { await api.patch(`/db/ref_workflow_role?id=eq.${r.id}`, { actif: !r.actif }); invalidate(); await refetch(); }
    catch { toast({ title: "Échec", variant: "destructive" }); }
    finally { setBusy(null); }
  };

  const setMembre = (i: number, p: Partial<WfRoleMembre>) => draft && setDraft({ ...draft, membres: draft.membres.map((m, k) => k === i ? { ...m, ...p } : m) });
  const addMembre = () => draft && setDraft({ ...draft, membres: [...draft.membres, { cible: "collaborateur", collaborateur_id: null, poste_code: null, unite_id: null, date_debut: null, date_fin: null, actif: true } as any] });
  const delMembre = (i: number) => draft && setDraft({ ...draft, membres: draft.membres.filter((_, k) => k !== i) });

  const save = async () => {
    if (!draft) return;
    if (!draft.code.trim() || !draft.libelle.trim()) { toast({ title: "Code et libellé obligatoires", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const fields = { code: draft.code.trim(), libelle: draft.libelle.trim(), description: draft.description || null,
        categorie: draft.categorie, couleur: draft.couleur || null, actif: draft.actif, ordre: draft.ordre, updated_at: new Date().toISOString() };
      let roleId = draft.id;
      if (roleId) await api.patch(`/db/ref_workflow_role?id=eq.${roleId}`, fields);
      else { await api.post("/db/ref_workflow_role", fields); roleId = ((await api.get(`/db/ref_workflow_role?code=eq.${fields.code}&select=id`)) as any[])[0]?.id; }
      if (roleId) await saveRoleMembres(roleId, draft.membres);
      toast({ title: "Rôle enregistré" });
      setDraft(null); invalidate(); await refetch();
    } catch { toast({ title: "Échec de l'enregistrement", description: "Vérifiez l'API (POST/PATCH/DELETE).", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}><Users size={20} /> Rôles workflow</h1>
          <p className="text-sm mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Rôles fonctionnels affectables dans les circuits (acteur « Rôle ») et leurs titulaires (collaborateur ou poste).</p>
        </div>
        <Button onClick={openNew} className="gap-1.5"><Plus size={15} /> Nouveau rôle</Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16" style={{ color: "hsl(var(--muted-foreground))" }}><Loader2 className="animate-spin mr-2" size={20} /> Chargement…</div>
      ) : roles.length === 0 ? (
        <div className="rounded-2xl border p-10 text-center" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>Aucun rôle. Créez-en un.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {roles.map((r) => {
            const col = r.couleur || catColor(r.categorie); const nb = (membresByRole[r.id] || []).length;
            return (
              <div key={r.id} className="rounded-2xl border p-4 flex flex-col gap-2.5" style={{ borderColor: "hsl(var(--border))", borderLeft: `4px solid ${col}`, opacity: r.actif ? 1 : 0.6 }}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: col + "22", color: col }}><Users size={18} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}>{r.libelle}<span className="text-[10px] font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>{r.code}</span></div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide" style={{ background: col + "1F", color: col }}>{r.categorie}</span>
                  </div>
                  <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg hover:bg-muted/50" title="Modifier" style={{ color: "hsl(var(--muted-foreground))" }}><Pencil size={15} /></button>
                </div>
                <div className="text-[12px] flex items-center gap-1.5" style={{ color: "hsl(var(--muted-foreground))" }}><UserPlus size={13} /> {nb} titulaire{nb > 1 ? "s" : ""}</div>
                <button type="button" disabled={busy === r.id} onClick={() => toggleActif(r)} className="self-start inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium"
                  style={{ background: r.actif ? "hsl(142 64% 40% / 0.12)" : "hsl(var(--muted))", color: r.actif ? "hsl(142 64% 32%)" : "hsl(var(--muted-foreground))" }}>
                  {busy === r.id ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />} {r.actif ? "Actif" : "Inactif"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-background rounded-2xl shadow-xl w-full max-w-[min(1100px,95vw)] p-5 space-y-4 max-h-[90vh] overflow-auto" style={{ border: "1px solid hsl(var(--border))" }}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>{draft.id ? "Modifier le rôle" : "Nouveau rôle"}</h2>
              <button onClick={() => setDraft(null)} style={{ color: "hsl(var(--muted-foreground))" }}><X size={18} /></button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Field label="Code *"><Input value={draft.code} disabled={!!draft.id} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="directeur_general" /></Field>
              <Field label="Libellé *"><Input value={draft.libelle} onChange={(e) => setDraft({ ...draft, libelle: e.target.value })} /></Field>
              <Field label="Catégorie"><Select value={draft.categorie} onChange={(v) => setDraft({ ...draft, categorie: v })} options={CATEGORIES_ROLE.map(c => ({ v: c, l: c }))} className="w-full" /></Field>
              <Field label="Couleur"><Input type="color" value={draft.couleur || catColor(draft.categorie)} onChange={(e) => setDraft({ ...draft, couleur: e.target.value })} className="h-9 p-1" /></Field>
              <Field label="Ordre"><Input type="number" value={draft.ordre} onChange={(e) => setDraft({ ...draft, ordre: parseInt(e.target.value) || 0 })} /></Field>
            </div>
            <Field label="Description"><Input value={draft.description || ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>

            <div className="rounded-xl border p-3" style={{ borderColor: "hsl(var(--border))" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-semibold flex items-center gap-1.5" style={{ color: "hsl(var(--foreground))" }}><UserPlus size={14} /> Titulaires</span>
                <button onClick={addMembre} className="text-[12px] font-medium hover:underline" style={{ color: "hsl(var(--primary))" }}>+ ajouter</button>
              </div>
              <div className="space-y-2 overflow-x-auto">
                {draft.membres.map((m, i) => {
                  const cible = (m as any).cible || (m.poste_code ? "poste" : "collaborateur");
                  return (
                    <div key={i} className="flex flex-nowrap items-center gap-2 min-w-max">
                      <Select value={cible} onChange={(v) => setMembre(i, { cible: v, collaborateur_id: null, poste_code: null } as any)}
                        options={[{ v: "collaborateur", l: "Collaborateur" }, { v: "poste", l: "Poste" }]} className="w-32 shrink-0" />
                      {cible === "collaborateur"
                        ? <PickerField value={m.collaborateur_id} label={m.collaborateur_id ? collabLabel[m.collaborateur_id] : ""} placeholder="Choisir un collaborateur…" className="w-[28rem] shrink-0" onOpen={() => setPicker({ i, kind: "collaborateur" })} onClear={() => setMembre(i, { collaborateur_id: null })} />
                        : <PickerField value={m.poste_code} label={m.poste_code ? posteLabel[m.poste_code] : ""} placeholder="Choisir un poste…" className="w-[28rem] shrink-0" onOpen={() => setPicker({ i, kind: "poste" })} onClear={() => setMembre(i, { poste_code: null })} />}
                      <UoSelect value={m.unite_id} onChange={(id) => setMembre(i, { unite_id: id })} options={uoHier} className="w-72 shrink-0" />
                      <input type="date" value={m.date_debut || ""} onChange={(e) => setMembre(i, { date_debut: e.target.value || null })} className="h-9 rounded-md border px-2 text-sm bg-background shrink-0" style={{ borderColor: "hsl(var(--border))" }} title="Début" />
                      <input type="date" value={m.date_fin || ""} onChange={(e) => setMembre(i, { date_fin: e.target.value || null })} className="h-9 rounded-md border px-2 text-sm bg-background shrink-0" style={{ borderColor: "hsl(var(--border))" }} title="Fin" />
                      <button onClick={() => delMembre(i)} style={{ color: "hsl(var(--destructive))" }}><Trash2 size={14} /></button>
                    </div>
                  );
                })}
                {draft.membres.length === 0 && <p className="text-[11px] italic" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun titulaire — le moteur ne pourra pas résoudre ce rôle.</p>}
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button type="button" onClick={() => setDraft({ ...draft, actif: !draft.actif })} className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: draft.actif ? "hsl(142 64% 32%)" : "hsl(var(--muted-foreground))" }}>
                <Power size={13} /> {draft.actif ? "Actif" : "Inactif"}
              </button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setDraft(null)}>Annuler</Button>
                <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Enregistrer</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {picker && draft && (
        <SearchPopup
          title={picker.kind === "collaborateur" ? "Choisir un collaborateur" : "Choisir un poste"}
          options={picker.kind === "collaborateur" ? collaborateurs : postes}
          onClose={() => setPicker(null)}
          onPick={(id) => {
            setMembre(picker.i, picker.kind === "collaborateur" ? { collaborateur_id: id, poste_code: null } : { poste_code: id, collaborateur_id: null });
            setPicker(null);
          }}
        />
      )}
    </div>
  );
}

// ── Champ déclencheur du popup de recherche ───────────────────────
const PickerField: React.FC<{ value: string | null; label?: string; placeholder: string; className?: string; onOpen: () => void; onClear: () => void }> = ({ value, label, placeholder, className, onOpen, onClear }) => (
  <div className={`relative ${className || ""}`}>
    <button type="button" onClick={onOpen}
      className="h-9 w-full rounded-md border pl-7 pr-7 text-sm bg-background text-left truncate"
      style={{ borderColor: "hsl(var(--border))", color: value ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))" }}>
      {value ? label : placeholder}
    </button>
    <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "hsl(var(--muted-foreground))" }} />
    {value && (
      <button type="button" onClick={onClear} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted/50" title="Effacer" style={{ color: "hsl(var(--muted-foreground))" }}>
        <X size={13} />
      </button>
    )}
  </div>
);

// ── Popup de recherche (modale centrée, liste lisible) ──────────────
const SearchPopup: React.FC<{ title: string; options: OptionLite[]; onPick: (id: string) => void; onClose: () => void }> = ({ title, options, onPick, onClose }) => {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const filtered = (ql ? options.filter((o) => o.label.toLowerCase().includes(ql)) : options).slice(0, 300);
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-4 pt-24" onMouseDown={onClose}>
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" style={{ border: "1px solid hsl(var(--border))" }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "hsl(var(--border))" }}>
          <h3 className="font-semibold text-sm" style={{ color: "hsl(var(--foreground))" }}>{title}</h3>
          <button type="button" onClick={onClose} style={{ color: "hsl(var(--muted-foreground))" }}><X size={18} /></button>
        </div>
        <div className="p-3 border-b" style={{ borderColor: "hsl(var(--border))" }}>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…"
              className="h-10 w-full rounded-lg border pl-9 pr-3 text-sm bg-background" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }} />
          </div>
        </div>
        <div className="max-h-[50vh] overflow-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun résultat</div>
          ) : filtered.map((o) => (
            <button key={o.id} type="button" onClick={() => onPick(o.id)}
              className="block w-full text-left px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors" style={{ color: "hsl(var(--foreground))" }}>
              {o.label}
            </button>
          ))}
        </div>
        <div className="px-4 py-2 text-xs border-t" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
          {filtered.length} résultat{filtered.length > 1 ? "s" : ""}{options.length > 300 ? " (affinez la recherche)" : ""}
        </div>
      </div>
    </div>
  );
};

// ── Select UO hiérarchisé (indenté) ─────────────────────────────────────────
const UoSelect: React.FC<{ value: string | null; onChange: (id: string | null) => void; options: UoNode[]; className?: string }> = ({ value, onChange, options, className }) => (
  <select value={value || ""} onChange={(e) => onChange(e.target.value || null)} className={`h-9 rounded-md border px-2 text-sm bg-background ${className || ""}`} style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
    <option value="">— UO (option) —</option>
    {options.map((u) => (
      <option key={u.id} value={u.id}>{`${"\u00A0\u00A0".repeat(u.depth)}${u.depth > 0 ? "└ " : ""}${u.label}`}</option>
    ))}
  </select>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-1"><label className="text-[11px] font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</label>{children}</div>
);
const Select: React.FC<{ value: string; onChange: (v: string) => void; options: { v: string; l: string }[]; className?: string }> = ({ value, onChange, options, className }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} className={`h-9 rounded-md border px-2 text-sm bg-background ${className || ""}`} style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
    {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
  </select>
);
