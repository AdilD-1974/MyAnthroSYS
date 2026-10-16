/**
 * BaremeForm – Création/édition d'un barème (en-tête + lignes éditables).
 * Supporte saisie manuelle et import CSV (clé;valeur;commentaire).
 */
import React, { useEffect, useRef, useState } from "react";
import { db } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Save, Loader2, Plus, Trash2, Upload, Download } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface Props {
  editId: string | null;
  onBack: () => void;
}

interface Ligne {
  id?: string;
  cle: string;
  valeur: string;
  valeur_texte: string;
  commentaire: string;
  _new?: boolean;
  _deleted?: boolean;
}

const TYPES_CLE = ["TEXTE", "NUMERIQUE", "DATE"];
const TYPES_VALEUR = ["MONTANT", "TAUX", "NOMBRE", "TEXTE"];

const BaremeForm: React.FC<Props> = ({ editId, onBack }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    code: "",
    libelle: "",
    description: "",
    type_cle: "TEXTE",
    type_valeur: "MONTANT",
    date_debut_validite: "",
    date_fin_validite: "",
    decision_reference: "",
    actif: true,
  });
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editId) return;
    setLoading(true);
    Promise.all([
      db.findOne<any>("bareme", { id: editId, select: "*" }),
      db.list<any>("bareme_ligne", { bareme_id: editId, select: "*", order: "ordre" }),
    ]).then(([b, l]) => {
      if (b) {
        const d: any = b;
        setForm({
          code: d.code,
          libelle: d.libelle,
          description: d.description || "",
          type_cle: d.type_cle,
          type_valeur: d.type_valeur,
          date_debut_validite: d.date_debut_validite || "",
          date_fin_validite: d.date_fin_validite || "",
          decision_reference: d.decision_reference || "",
          actif: d.actif,
        });
      }
      if (l && l.length) {
        setLignes(
          l.map((l: any) => ({
            id: l.id,
            cle: l.cle,
            valeur: l.valeur != null ? String(l.valeur) : "",
            valeur_texte: l.valeur_texte || "",
            commentaire: l.commentaire || "",
          }))
        );
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [editId]);

  const addLigne = () => {
    setLignes([...lignes, { cle: "", valeur: "", valeur_texte: "", commentaire: "", _new: true }]);
  };

  const updateLigne = (idx: number, field: keyof Ligne, value: string) => {
    const next = [...lignes];
    (next[idx] as any)[field] = value;
    setLignes(next);
  };

  const removeLigne = (idx: number) => {
    const next = [...lignes];
    if (next[idx].id) {
      next[idx]._deleted = true;
      setLignes(next);
    } else {
      setLignes(next.filter((_, i) => i !== idx));
    }
  };

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      const rows = text.split(/\r?\n/).filter((r) => r.trim());
      const sep = text.includes(";") ? ";" : ",";
      const newLignes: Ligne[] = rows.map((r) => {
        const cols = r.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
        return { cle: cols[0] || "", valeur: cols[1] || "", valeur_texte: "", commentaire: cols[2] || "", _new: true };
      });
      // Détection en-tête : si la 1re ligne contient "cle"/"clé"/"key" on l'ignore
      const first = newLignes[0]?.cle.toLowerCase();
      const finalLignes = ["cle", "clé", "key"].includes(first || "") ? newLignes.slice(1) : newLignes;
      setLignes([...lignes, ...finalLignes]);
      toast({ title: "Import CSV", description: `${finalLignes.length} ligne(s) ajoutée(s).` });
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  };

  const handleExportCSV = () => {
    const header = "cle;valeur;commentaire";
    const body = lignes.filter((l) => !l._deleted).map((l) => `${l.cle};${l.valeur};${l.commentaire}`).join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bareme_${form.code || "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSave = async () => {
    if (!form.code.trim() || !form.libelle.trim()) {
      toast({ title: "Champs requis", description: "Code et libellé obligatoires.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      ...form,
      date_debut_validite: form.date_debut_validite || null,
      date_fin_validite: form.date_fin_validite || null,
      decision_reference: form.decision_reference || null,
      description: form.description || null,
    };
    let baremeId = editId;
    if (editId) {
      try {
        await db.update("bareme", { id: editId }, payload);
      } catch (e: any) {
        setSaving(false);
        toast({ title: "Erreur", description: e.message, variant: "destructive" });
        return;
      }
    } else {
      try {
        const created: any = await db.create("bareme", payload);
        baremeId = Array.isArray(created) ? created[0]?.id : created?.id;
      } catch (e: any) {
        setSaving(false);
        toast({ title: "Erreur", description: e.message, variant: "destructive" });
        return;
      }
      if (!baremeId) {
        setSaving(false);
        toast({ title: "Erreur", description: "Échec création du barème", variant: "destructive" });
        return;
      }
    }

    // Synchroniser les lignes
    const toDelete = lignes.filter((l) => l._deleted && l.id).map((l) => l.id!);
    const toInsert = lignes
      .filter((l) => l._new && !l._deleted && l.cle.trim())
      .map((l, i) => ({
        bareme_id: baremeId!,
        ordre: i,
        cle: l.cle,
        valeur: l.valeur ? Number(l.valeur) : null,
        valeur_texte: form.type_valeur === "TEXTE" ? l.valeur_texte || l.valeur : null,
        commentaire: l.commentaire || null,
      }));
    const toUpdate = lignes.filter((l) => l.id && !l._new && !l._deleted);

    if (toDelete.length > 0) {
      await db.remove("bareme_ligne", { id: `in.(${toDelete.join(",")})` });
    }
    if (toInsert.length > 0) {
      await db.create("bareme_ligne", toInsert);
    }
    for (const l of toUpdate) {
      await db.update("bareme_ligne", { id: l.id! }, {
        cle: l.cle,
        valeur: l.valeur ? Number(l.valeur) : null,
        valeur_texte: form.type_valeur === "TEXTE" ? l.valeur_texte || l.valeur : null,
        commentaire: l.commentaire || null,
      });
    }

    setSaving(false);
    toast({ title: editId ? "Barème modifié" : "Barème créé" });
    onBack();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="animate-spin mr-2" size={18} /> Chargement…
      </div>
    );
  }

  const visibleLignes = lignes.filter((l) => !l._deleted);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-5">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowLeft size={14} /> Retour
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
          {editId ? "Enregistrer" : "Créer"}
        </Button>
      </div>

      <h2 className="text-lg font-semibold text-foreground mb-1">{editId ? "Modifier" : "Nouveau"} barème</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Définissez l'en-tête puis les lignes (clé → valeur). Vous pouvez importer un CSV au format <code className="text-[10px] bg-muted px-1 rounded">cle;valeur;commentaire</code>.
      </p>

      {/* En-tête */}
      <div className="rounded-xl border border-border p-4 mb-5 space-y-3">
        <h3 className="text-sm font-semibold text-foreground mb-1">En-tête</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="code" className="text-xs">Code <span className="text-destructive">*</span></Label>
            <Input id="code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="EX: BAR_VALEUR_POINT" className="h-9 text-sm font-mono" />
          </div>
          <div>
            <Label htmlFor="libelle" className="text-xs">Libellé <span className="text-destructive">*</span></Label>
            <Input id="libelle" value={form.libelle} onChange={(e) => setForm({ ...form, libelle: e.target.value })} className="h-9 text-sm" />
          </div>
        </div>
        <div>
          <Label htmlFor="description" className="text-xs">Description</Label>
          <Textarea id="description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="text-sm min-h-[50px]" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Type de clé</Label>
            <select value={form.type_cle} onChange={(e) => setForm({ ...form, type_cle: e.target.value })} className="w-full h-9 text-sm rounded-md border border-input bg-background px-3">
              {TYPES_CLE.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Type de valeur</Label>
            <select value={form.type_valeur} onChange={(e) => setForm({ ...form, type_valeur: e.target.value })} className="w-full h-9 text-sm rounded-md border border-input bg-background px-3">
              {TYPES_VALEUR.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Date début validité</Label>
            <Input type="date" value={form.date_debut_validite} onChange={(e) => setForm({ ...form, date_debut_validite: e.target.value })} className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Date fin validité</Label>
            <Input type="date" value={form.date_fin_validite} onChange={(e) => setForm({ ...form, date_fin_validite: e.target.value })} className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Référence décision</Label>
            <Input value={form.decision_reference} onChange={(e) => setForm({ ...form, decision_reference: e.target.value })} className="h-9 text-sm" />
          </div>
        </div>
        <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30">
          <Label className="text-sm font-medium">Barème actif</Label>
          <Switch checked={form.actif} onCheckedChange={(v) => setForm({ ...form, actif: v })} />
        </div>
      </div>

      {/* Lignes */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-foreground">Lignes du barème ({visibleLignes.length})</h3>
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleImportCSV} />
            <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => fileInputRef.current?.click()}>
              <Upload size={12} /> Importer CSV
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={handleExportCSV} disabled={visibleLignes.length === 0}>
              <Download size={12} /> Export
            </Button>
            <Button size="sm" className="gap-1.5 h-8" onClick={addLigne}>
              <Plus size={12} /> Ligne
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-semibold w-12">#</th>
                <th className="px-3 py-2 font-semibold">Clé</th>
                <th className="px-3 py-2 font-semibold">Valeur</th>
                <th className="px-3 py-2 font-semibold">Commentaire</th>
                <th className="px-3 py-2 font-semibold w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lignes.map((l, idx) => {
                if (l._deleted) return null;
                return (
                  <tr key={idx} className="hover:bg-muted/20">
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{idx + 1}</td>
                    <td className="px-3 py-1.5">
                      <Input value={l.cle} onChange={(e) => updateLigne(idx, "cle", e.target.value)} placeholder="Clé" className="h-8 text-sm" />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        type={form.type_valeur === "TEXTE" ? "text" : "number"}
                        step="0.0001"
                        value={l.valeur}
                        onChange={(e) => updateLigne(idx, "valeur", e.target.value)}
                        placeholder="Valeur"
                        className="h-8 text-sm"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input value={l.commentaire} onChange={(e) => updateLigne(idx, "commentaire", e.target.value)} className="h-8 text-sm" />
                    </td>
                    <td className="px-3 py-1.5">
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeLigne(idx)}>
                        <Trash2 size={12} />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {visibleLignes.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground">
                    Aucune ligne. Ajoutez-en une ou importez un CSV.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default BaremeForm;
