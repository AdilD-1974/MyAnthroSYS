import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { renderIcon } from "@/hooks/menuIcons";
import { useEspaces, Espace } from "@/hooks/useEspaces";
import { LayoutGrid, Plus, Pencil, Save, Loader2, X, Power, Check } from "lucide-react";

const ROLES = [
  { code: "administrateur", label: "Administrateur" },
  { code: "gestionnaire_rh", label: "Gestionnaire RH" },
  { code: "gestionnaire_paie", label: "Gestionnaire Paie" },
  { code: "manager", label: "Manager" },
  { code: "collaborateur", label: "Collaborateur" },
];

interface Draft {
  id?: string;
  code: string;
  libelle: string;
  icone: string;
  route_accueil: string;
  couleur: string;
  ordre: number;
  actif: boolean;
  roles: Set<string>;
  _initialRoles: Set<string>;
}

const emptyDraft = (ordre: number): Draft => ({
  code: "", libelle: "", icone: "layout-grid", route_accueil: "", couleur: "#14B8A6",
  ordre, actif: true, roles: new Set(), _initialRoles: new Set(),
});

export default function EspacesAccessPage() {
  const qc = useQueryClient();
  const { espaces, loading, refetch } = useEspaces();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["espaces"] });
    qc.invalidateQueries({ queryKey: ["menu-tree"] });
  };

  const openNew = () => setDraft(emptyDraft((espaces.at(-1)?.ordre ?? 0) + 1));
  const openEdit = (e: Espace) => setDraft({
    id: e.id, code: e.code, libelle: e.libelle, icone: e.icone || "layout-grid",
    route_accueil: e.route_accueil || "", couleur: e.couleur || "#14B8A6",
    ordre: e.ordre, actif: e.actif, roles: new Set(e.roles), _initialRoles: new Set(e.roles),
  });

  const toggleActif = async (e: Espace) => {
    setBusy(e.id);
    try {
      await api.patch(`/db/ref_espace?id=eq.${e.id}`, { actif: !e.actif });
      invalidate(); await refetch();
    } catch { toast({ title: "Échec", description: "Activation impossible.", variant: "destructive" }); }
    finally { setBusy(null); }
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.code.trim() || !draft.libelle.trim()) {
      toast({ title: "Champs requis", description: "Code et libellé sont obligatoires.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const fields = {
        code: draft.code.trim(), libelle: draft.libelle.trim(), icone: draft.icone.trim() || null,
        route_accueil: draft.route_accueil.trim() || null, couleur: draft.couleur || null,
        ordre: draft.ordre, actif: draft.actif,
      };
      let espaceId = draft.id;
      if (espaceId) {
        await api.patch(`/db/ref_espace?id=eq.${espaceId}`, fields);
      } else {
        await api.post("/db/ref_espace", fields);
        const rows = await api.get(`/db/ref_espace?code=eq.${fields.code}&select=id`) as any[];
        espaceId = rows?.[0]?.id;
      }
      // Diff des rôles autorisés
      if (espaceId) {
        const adds = [...draft.roles].filter(r => !draft._initialRoles.has(r));
        const dels = [...draft._initialRoles].filter(r => !draft.roles.has(r));
        for (const role of adds) await api.post("/db/espace_role", { espace_id: espaceId, role });
        for (const role of dels) await (api as any).delete(`/db/espace_role?espace_id=eq.${espaceId}&role=eq.${role}`);
      }
      toast({ title: "Espace enregistré" });
      setDraft(null); invalidate(); await refetch();
    } catch {
      toast({ title: "Échec de l'enregistrement", description: "Vérifiez que le proxy autorise POST/PATCH/DELETE sur ref_espace / espace_role.", variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}>
            <LayoutGrid size={20} /> Gestion des accès — Espaces
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
            Espaces de travail sélectionnables (« Changer d'espace ») et rôles autorisés à les activer.
          </p>
        </div>
        <Button onClick={openNew} className="gap-1.5"><Plus size={15} /> Nouvel espace</Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16" style={{ color: "hsl(var(--muted-foreground))" }}>
          <Loader2 className="animate-spin mr-2" size={20} /> Chargement…
        </div>
      ) : espaces.length === 0 ? (
        <div className="rounded-2xl border p-10 text-center" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
          Aucun espace défini. Cliquez sur « Nouvel espace » pour commencer.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {espaces.map((e) => (
            <div key={e.id} className="rounded-2xl border p-4 flex flex-col gap-3" style={{ borderColor: "hsl(var(--border))", opacity: e.actif ? 1 : 0.6 }}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: (e.couleur || "#14B8A6") + "22", color: e.couleur || "#14B8A6" }}>
                  {renderIcon(e.icone || "layout-grid", 20)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}>
                    {e.libelle}
                    <span className="text-[10px] font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>{e.code}</span>
                  </div>
                  <div className="text-[12px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {e.route_accueil || "— pas de route d'accueil"}
                  </div>
                </div>
                <button type="button" onClick={() => openEdit(e)} className="p-1.5 rounded-lg hover:bg-muted/50" title="Modifier" style={{ color: "hsl(var(--muted-foreground))" }}>
                  <Pencil size={15} />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {e.roles.length === 0 ? (
                  <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun rôle autorisé</span>
                ) : e.roles.map(r => (
                  <span key={r} className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                    {ROLES.find(x => x.code === r)?.label || r}
                  </span>
                ))}
              </div>
              <button type="button" disabled={busy === e.id} onClick={() => toggleActif(e)}
                className="self-start inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium"
                style={{ background: e.actif ? "hsl(142 64% 40% / 0.12)" : "hsl(var(--muted))", color: e.actif ? "hsl(142 64% 32%)" : "hsl(var(--muted-foreground))" }}>
                {busy === e.id ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />} {e.actif ? "Actif" : "Inactif"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Modal création / édition */}
      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-background rounded-2xl shadow-xl max-w-lg w-full p-5 space-y-4 max-h-[90vh] overflow-auto" style={{ border: "1px solid hsl(var(--border))" }}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>{draft.id ? "Modifier l'espace" : "Nouvel espace"}</h2>
              <button type="button" onClick={() => setDraft(null)} style={{ color: "hsl(var(--muted-foreground))" }}><X size={18} /></button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Code *"><Input value={draft.code} disabled={!!draft.id} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="manager" /></Field>
              <Field label="Libellé *"><Input value={draft.libelle} onChange={(e) => setDraft({ ...draft, libelle: e.target.value })} placeholder="Espace Manager" /></Field>
              <Field label="Icône (nom)">
                <div className="flex items-center gap-2">
                  <Input value={draft.icone} onChange={(e) => setDraft({ ...draft, icone: e.target.value })} placeholder="users" />
                  <span style={{ color: draft.couleur }}>{renderIcon(draft.icone || "layout-grid", 18)}</span>
                </div>
              </Field>
              <Field label="Couleur"><Input type="color" value={draft.couleur} onChange={(e) => setDraft({ ...draft, couleur: e.target.value })} className="h-9 p-1" /></Field>
              <Field label="Route d'accueil"><Input value={draft.route_accueil} onChange={(e) => setDraft({ ...draft, route_accueil: e.target.value })} placeholder="/espace-manager" /></Field>
              <Field label="Ordre"><Input type="number" value={draft.ordre} onChange={(e) => setDraft({ ...draft, ordre: parseInt(e.target.value) || 0 })} /></Field>
            </div>

            <div>
              <div className="text-[12px] font-medium mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>Rôles autorisés à activer cet espace</div>
              <div className="flex flex-wrap gap-2">
                {ROLES.map(r => {
                  const on = draft.roles.has(r.code);
                  return (
                    <button key={r.code} type="button"
                      onClick={() => { const n = new Set(draft.roles); on ? n.delete(r.code) : n.add(r.code); setDraft({ ...draft, roles: n }); }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors"
                      style={{ background: on ? "hsl(var(--primary))" : "hsl(var(--muted))", color: on ? "white" : "hsl(var(--muted-foreground))" }}>
                      {on && <Check size={12} />} {r.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button type="button" onClick={() => setDraft({ ...draft, actif: !draft.actif })}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium"
                style={{ color: draft.actif ? "hsl(142 64% 32%)" : "hsl(var(--muted-foreground))" }}>
                <Power size={13} /> {draft.actif ? "Actif" : "Inactif"}
              </button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setDraft(null)}>Annuler</Button>
                <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Enregistrer
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-1">
    <label className="text-[11px] font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</label>
    {children}
  </div>
);
