import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Plus, Pencil, X, Settings2, RefreshCw, Check, Trash2,
} from "lucide-react";

// =====================================================
// RG-DEP-PROV-CONFIG (Adil DAIA) :
//   Paramétrage des motifs de départ provisoire
// =====================================================

interface Motif {
  code: string;
  libelle: string;
  description: string | null;
  reconductible: boolean;
  nombre_reconductions_max: number | null;
  duree_max_periode_jours: number | null;
  duree_globale_max_jours: number | null;
  reste_dans_effectif: boolean;
  actif: boolean;
}

const EMPTY: Motif = {
  code: "", libelle: "", description: null,
  reconductible: false, nombre_reconductions_max: null,
  duree_max_periode_jours: null, duree_globale_max_jours: null,
  reste_dans_effectif: false, actif: true,
};

const MotifsDepartProvisoirePage: React.FC = () => {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Motif | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: motifs = [], isLoading } = useQuery<Motif[]>({
    queryKey: ["ref_motif_depart_provisoire"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ref_motif_depart_provisoire" as never)
        .select("*")
        .order("libelle") as any;
      if (error) throw error;
      return data || [];
    },
  });

  const save = async () => {
    if (!editing) return;
    if (!editing.code.trim() || !editing.libelle.trim()) {
      toast({ title: "Code et libellé sont requis", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        const { error } = await supabase
          .from("ref_motif_depart_provisoire" as never)
          .insert(editing as never) as any;
        if (error) throw error;
      } else {
        const { code, ...rest } = editing;
        const { error } = await supabase
          .from("ref_motif_depart_provisoire" as never)
          .update(rest as never)
          .eq("code", code) as any;
        if (error) throw error;
      }
      toast({ title: isNew ? "Motif créé" : "Motif mis à jour" });
      qc.invalidateQueries({ queryKey: ["ref_motif_depart_provisoire"] });
      setEditing(null);
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Settings2 size={20} style={{ color: "hsl(var(--accent))" }} />
            <h1 className="text-xl font-bold" style={{ color: "hsl(var(--foreground))" }}>
              Motifs de départ provisoire
            </h1>
          </div>
          <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
            Paramétrage des types de départ temporaire : détachement, disponibilité, congés spécifiques…
          </p>
        </div>
        <Button size="sm" onClick={() => { setEditing({ ...EMPTY }); setIsNew(true); }}>
          <Plus size={15} className="mr-1" /> Nouveau motif
        </Button>
      </div>

      {/* Liste */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "hsl(var(--muted) / 0.5)", borderBottom: "1px solid hsl(var(--border))" }}>
              {["Code", "Libellé", "Reconductible", "Max reconductions", "Durée max/période", "Durée globale max", "Dans effectif", "Actif", ""].map(h => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={9} className="py-12 text-center text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Chargement…</td></tr>
            ) : motifs.length === 0 ? (
              <tr><td colSpan={9} className="py-12 text-center text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun motif configuré</td></tr>
            ) : motifs.map((m, i) => (
              <tr key={m.code} style={{
                background: i % 2 === 0 ? "hsl(var(--card))" : "hsl(var(--muted) / 0.2)",
                borderBottom: "1px solid hsl(var(--border) / 0.5)",
              }}>
                <td className="px-4 py-3 text-xs font-mono font-medium" style={{ color: "hsl(var(--foreground))" }}>{m.code}</td>
                <td className="px-4 py-3 text-xs font-medium" style={{ color: "hsl(var(--foreground))" }}>{m.libelle}</td>
                <td className="px-4 py-3 text-xs" style={{ color: "hsl(var(--foreground))" }}>
                  {m.reconductible ? <Check size={14} style={{ color: "hsl(142 55% 40%)" }} /> : "—"}
                </td>
                <td className="px-4 py-3 text-xs" style={{ color: "hsl(var(--foreground))" }}>{m.nombre_reconductions_max ?? "—"}</td>
                <td className="px-4 py-3 text-xs" style={{ color: "hsl(var(--foreground))" }}>
                  {m.duree_max_periode_jours ? `${m.duree_max_periode_jours} j` : "—"}
                </td>
                <td className="px-4 py-3 text-xs" style={{ color: "hsl(var(--foreground))" }}>
                  {m.duree_globale_max_jours ? `${m.duree_globale_max_jours} j` : "—"}
                </td>
                <td className="px-4 py-3 text-xs">
                  {m.reste_dans_effectif
                    ? <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium" style={{ background: "hsl(142 55% 45% / 0.12)", color: "hsl(142 55% 30%)" }}>Oui</span>
                    : <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium" style={{ background: "hsl(0 70% 50% / 0.10)", color: "hsl(0 70% 40%)" }}>Non</span>
                  }
                </td>
                <td className="px-4 py-3 text-xs">
                  {m.actif
                    ? <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium" style={{ background: "hsl(142 55% 45% / 0.12)", color: "hsl(142 55% 30%)" }}>Actif</span>
                    : <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>Inactif</span>
                  }
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => { setEditing({ ...m }); setIsNew(false); }}
                    className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
                    style={{ background: "hsl(var(--accent) / 0.1)", color: "hsl(var(--accent))" }}>
                    <Pencil size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal édition */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "hsl(var(--background) / 0.85)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden"
            style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
            <div className="flex items-center justify-between px-6 py-4 border-b"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
              <h2 className="text-base font-bold" style={{ color: "hsl(var(--foreground))" }}>
                {isNew ? "Nouveau motif" : `Modifier : ${editing.libelle}`}
              </h2>
              <button onClick={() => setEditing(null)} className="p-1.5 rounded-lg hover:opacity-70"
                style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                <X size={16} />
              </button>
            </div>
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-semibold mb-1.5 block">Code *</Label>
                  <Input value={editing.code} disabled={!isNew}
                    onChange={e => setEditing({ ...editing, code: e.target.value.toUpperCase() })}
                    className="h-9 text-sm font-mono" placeholder="DETACHEMENT" />
                </div>
                <div>
                  <Label className="text-xs font-semibold mb-1.5 block">Libellé *</Label>
                  <Input value={editing.libelle}
                    onChange={e => setEditing({ ...editing, libelle: e.target.value })}
                    className="h-9 text-sm" />
                </div>
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1.5 block">Description</Label>
                <Textarea value={editing.description || ""} rows={2} className="text-sm resize-none"
                  onChange={e => setEditing({ ...editing, description: e.target.value || null })} />
              </div>

              {/* Reconduction */}
              <div className="rounded-lg p-4 space-y-3" style={{ background: "hsl(var(--muted) / 0.3)", border: "1px solid hsl(var(--border))" }}>
                <p className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>Paramètres de reconduction</p>
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Reconductible</Label>
                  <Switch checked={editing.reconductible}
                    onCheckedChange={v => setEditing({ ...editing, reconductible: v })} />
                </div>
                {editing.reconductible && (
                  <div>
                    <Label className="text-xs mb-1 block">Nombre max de reconductions</Label>
                    <Input type="number" min={1} className="h-8 text-sm w-32"
                      value={editing.nombre_reconductions_max ?? ""}
                      onChange={e => setEditing({ ...editing, nombre_reconductions_max: e.target.value ? Number(e.target.value) : null })} />
                  </div>
                )}
              </div>

              {/* Durées */}
              <div className="rounded-lg p-4 space-y-3" style={{ background: "hsl(var(--muted) / 0.3)", border: "1px solid hsl(var(--border))" }}>
                <p className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>Durées maximales (jours)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs mb-1 block">Durée max par période</Label>
                    <Input type="number" min={1} className="h-8 text-sm"
                      value={editing.duree_max_periode_jours ?? ""}
                      onChange={e => setEditing({ ...editing, duree_max_periode_jours: e.target.value ? Number(e.target.value) : null })} />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Durée globale autorisée</Label>
                    <Input type="number" min={1} className="h-8 text-sm"
                      value={editing.duree_globale_max_jours ?? ""}
                      onChange={e => setEditing({ ...editing, duree_globale_max_jours: e.target.value ? Number(e.target.value) : null })} />
                  </div>
                </div>
              </div>

              {/* Flags */}
              <div className="flex items-center justify-between">
                <Label className="text-xs">Reste dans l'effectif</Label>
                <Switch checked={editing.reste_dans_effectif}
                  onCheckedChange={v => setEditing({ ...editing, reste_dans_effectif: v })} />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Actif</Label>
                <Switch checked={editing.actif}
                  onCheckedChange={v => setEditing({ ...editing, actif: v })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
              <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>Annuler</Button>
              <Button onClick={save} disabled={saving}>
                {saving ? "Enregistrement…" : isNew ? "Créer" : "Enregistrer"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MotifsDepartProvisoirePage;
