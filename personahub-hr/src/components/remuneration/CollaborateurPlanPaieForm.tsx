/**
 * CollaborateurPlanPaieForm – Affectation d'un collaborateur à un plan de paie
 * avec gestion par période (date de début / date de fin d'effet).
 * Règle : un seul plan actif à la fois (contrôlé par trigger DB anti-chevauchement).
 */
import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Save, X, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Plan = { id: string; code: string; libelle: string; frequence: string; actif: boolean };
type Affectation = {
  id: string;
  collaborateur_id: string;
  plan_paie_id: string;
  date_debut: string;
  date_fin: string | null;
  commentaire: string | null;
  archive: boolean;
  plan?: Plan;
};

const today = () => new Date().toISOString().slice(0, 10);

const CollaborateurPlanPaieForm: React.FC<{ collaborateurId: string }> = ({ collaborateurId }) => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [affectations, setAffectations] = useState<Affectation[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<{ plan_paie_id: string; date_debut: string; date_fin: string; commentaire: string }>({
    plan_paie_id: "",
    date_debut: today(),
    date_fin: "",
    commentaire: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    // FIX : le proxy FastAPI ne supporte pas la jointure imbriquée Supabase
    // ("plan:plan_paie(...)") ni le "*" + jointure. On charge d'abord la liste
    // des plans (toujours nécessaire pour le formulaire de saisie), puis les
    // affectations en colonnes explicites, et on fait la jointure côté JS.
    const [{ data: p }, { data: a }] = await Promise.all([
      supabase
        .from("plan_paie")
        .select("id,code,libelle,frequence,actif")
        .eq("actif", true)
        .order("code"),
      supabase
        .from("collaborateur_plan_paie")
        .select("id,collaborateur_id,plan_paie_id,date_debut,date_fin,commentaire,archive")
        .eq("collaborateur_id", collaborateurId)
        .eq("archive", false)
        .order("date_debut", { ascending: false }),
    ]);
    const allPlans = (p as Plan[]) || [];
    const rawAffectations = (a as any[]) || [];
    // Jointure côté JS : on attache le plan correspondant à chaque affectation
    const enriched: Affectation[] = rawAffectations.map((row) => ({
      ...row,
      plan: allPlans.find((pl) => pl.id === row.plan_paie_id),
    }));
    setPlans(allPlans);
    setAffectations(enriched);
    setLoading(false);
  }, [collaborateurId]);

  useEffect(() => { load(); }, [load]);

  const startNew = () => {
    // Pré-clôturer la précédente si pas de date_fin : suggérer date début = lendemain de la dernière fin connue, ou aujourd'hui
    const active = affectations.find(a => !a.date_fin);
    setForm({
      plan_paie_id: plans[0]?.id || "",
      date_debut: active ? today() : today(),
      date_fin: "",
      commentaire: "",
    });
    setEditingId("new");
  };

  const startEdit = (a: Affectation) => {
    setForm({
      plan_paie_id: a.plan_paie_id,
      date_debut: a.date_debut,
      date_fin: a.date_fin || "",
      commentaire: a.commentaire || "",
    });
    setEditingId(a.id);
  };

  const cancel = () => { setEditingId(null); };

  const save = async () => {
    if (!form.plan_paie_id) { toast.error("Sélectionnez un plan de paie"); return; }
    if (!form.date_debut) { toast.error("Date de début obligatoire"); return; }
    if (form.date_fin && form.date_fin < form.date_debut) { toast.error("La date de fin doit être ≥ date de début"); return; }

    const payload = {
      collaborateur_id: collaborateurId,
      plan_paie_id: form.plan_paie_id,
      date_debut: form.date_debut,
      date_fin: form.date_fin || null,
      commentaire: form.commentaire || null,
    };

    if (editingId === "new") {
      const { error } = await supabase.from("collaborateur_plan_paie").insert(payload);
      if (error) { toast.error(error.message); return; }
      toast.success("Affectation créée");
    } else if (editingId) {
      const { error } = await supabase.from("collaborateur_plan_paie").update(payload).eq("id", editingId);
      if (error) { toast.error(error.message); return; }
      toast.success("Affectation modifiée");
    }
    setEditingId(null);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Supprimer cette affectation ?")) return;
    const { error } = await supabase.from("collaborateur_plan_paie").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Affectation supprimée");
    load();
  };

  const isActive = (a: Affectation) => {
    const t = today();
    return a.date_debut <= t && (!a.date_fin || a.date_fin >= t);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Un collaborateur ne peut être affecté qu'à <strong>un seul plan de paie</strong> à la fois (géré par dates d'effet).
        </p>
        {editingId === null && (
          <Button size="sm" variant="outline" className="gap-1 h-8 text-xs" onClick={startNew}>
            <Plus size={12} /> Nouvelle affectation
          </Button>
        )}
      </div>

      {/* Formulaire inline */}
      {editingId !== null && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <Label className="text-xs">Plan de paie *</Label>
              <Select value={form.plan_paie_id} onValueChange={(v) => setForm({ ...form, plan_paie_id: v })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                <SelectContent>
                  {plans.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="font-mono text-xs mr-2">{p.code}</span>{p.libelle}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Date d'effet *</Label>
              <Input type="date" value={form.date_debut} onChange={(e) => setForm({ ...form, date_debut: e.target.value })} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Date de fin</Label>
              <Input type="date" value={form.date_fin} onChange={(e) => setForm({ ...form, date_fin: e.target.value })} className="h-9 text-sm" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Commentaire</Label>
            <Input value={form.commentaire} onChange={(e) => setForm({ ...form, commentaire: e.target.value })} className="h-9 text-sm" />
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={cancel} className="gap-1 h-8 text-xs"><X size={12} /> Annuler</Button>
            <Button size="sm" onClick={save} className="gap-1 h-8 text-xs"><Save size={12} /> Enregistrer</Button>
          </div>
        </div>
      )}

      {/* Historique */}
      {loading ? (
        <div className="text-center py-4 text-muted-foreground text-sm">Chargement…</div>
      ) : affectations.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
          <CalendarRange size={20} className="mx-auto mb-2 opacity-50" />
          Aucun plan de paie affecté à ce collaborateur.
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs">Plan de paie</TableHead>
                <TableHead className="text-xs">Date début</TableHead>
                <TableHead className="text-xs">Date fin</TableHead>
                <TableHead className="text-xs">Statut</TableHead>
                <TableHead className="text-xs">Commentaire</TableHead>
                <TableHead className="text-xs w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {affectations.map(a => (
                <TableRow key={a.id} className="text-xs">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted">{a.plan?.code}</span>
                      <span className="font-medium">{a.plan?.libelle}</span>
                    </div>
                  </TableCell>
                  <TableCell>{a.date_debut}</TableCell>
                  <TableCell>{a.date_fin || <span className="text-muted-foreground italic">—</span>}</TableCell>
                  <TableCell>
                    {isActive(a) ? (
                      <Badge className="text-[10px]">En cours</Badge>
                    ) : a.date_fin && a.date_fin < today() ? (
                      <Badge variant="secondary" className="text-[10px]">Terminée</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">À venir</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-[200px] truncate">{a.commentaire || "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => startEdit(a)}>
                        <Pencil size={11} />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => remove(a.id)}>
                        <Trash2 size={11} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default CollaborateurPlanPaieForm;
