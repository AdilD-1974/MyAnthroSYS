/**
 * AvantageForm – CRUD pour les avantages d'un collaborateur.
 * Les avantages sont sélectionnés parmi les rubriques de famille "Avantages".
 */
import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, X, Save, Award, Loader2 } from "lucide-react";

interface Avantage {
  id: string;
  collaborateur_id: string;
  code_avantage: string;
  valeur_monetaire: number | null;
  valeur_nature: string | null;
  date_debut: string | null;
  date_fin: string | null;
  est_brut: boolean;
  archive: boolean;
}

interface RubriqueOption {
  code: string;
  libelle: string;
}

const EMPTY_FORM = {
  code_avantage: "",
  valeur_monetaire: "",
  date_debut: "",
  date_fin: "",
  est_brut: "true",
  valeur_nature: "",
};

interface Props {
  collaborateurId: string;
  readOnly?: boolean;
}

const AvantageForm: React.FC<Props> = ({ collaborateurId, readOnly = false }) => {
  const [avantages, setAvantages] = useState<Avantage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [rubriques, setRubriques] = useState<RubriqueOption[]>([]);

  // Charger les rubriques de famille "Avantages"
  // RG-AVT-04 (Adil DAIA) : source corrigée — ref_rubrique/ref_famille_rubrique
  // sont des tables déconnectées de rubrique_paie (jamais alimentées par le
  // moteur de paie réel). On lit désormais rubrique_paie/
  // ref_famille_rubrique_paie, et on exclut les rubriques déjà liées à la
  // table des salaires fixes (rubrique_paie_alimentation, table_source=
  // collaborateur_salaires_fixes) : une rubrique saisie via une zone fixe
  // des Éléments fixes du salaire n'a pas à réapparaître ici, pour éviter
  // une double saisie possible pour la même rubrique.
  useEffect(() => {
    (async () => {
      const { data: familles } = await supabase
        .from("ref_famille_rubrique_paie" as any)
        .select("code, libelle")
        .eq("actif", true);

      const familleAvantages = (familles || []).find(
        (f: any) => f.libelle?.toLowerCase().includes("avantage")
      );
      if (!familleAvantages) { setRubriques([]); return; }

      const [{ data: rubData }, { data: alimData }] = await Promise.all([
        supabase
          .from("rubrique_paie" as any)
          .select("code, libelle")
          .eq("code_famille", (familleAvantages as any).code)
          .eq("traiter", true)
          .eq("archive", false)
          .order("libelle"),
        supabase
          .from("rubrique_paie_alimentation" as any)
          .select("code_rubrique")
          .eq("table_source", "collaborateur_salaires_fixes"),
      ]);

      const dejaLiees = new Set(((alimData as any[]) || []).map(a => a.code_rubrique));
      const disponibles = ((rubData as RubriqueOption[] | null) || []).filter(r => !dejaLiees.has(r.code));
      setRubriques(disponibles);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("collaborateur_avantages")
      .select("*")
      .eq("collaborateur_id", collaborateurId)
      .eq("archive", false)
      .order("date_debut", { ascending: false });
    setAvantages((data || []) as Avantage[]);
    setLoading(false);
  }, [collaborateurId]);

  useEffect(() => { load(); }, [load]);

  // RG-AVT-03 : Affichage du libellé uniquement (sans code rubrique) – Auteur : Adil DAIA
  const getRubriqueLabel = (code: string) => {
    const r = rubriques.find(rb => rb.code === code);
    return r ? r.libelle : code;
  };

  const isEnCours = (a: Avantage) => {
    if (!a.date_fin) return true;
    return new Date(a.date_fin) >= new Date();
  };

  const openNew = () => {
    setForm({ ...EMPTY_FORM });
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (a: Avantage) => {
    setForm({
      code_avantage: a.code_avantage || "",
      valeur_monetaire: a.valeur_monetaire != null ? String(a.valeur_monetaire) : "",
      date_debut: a.date_debut || "",
      date_fin: a.date_fin || "",
      est_brut: String(a.est_brut),
      valeur_nature: a.valeur_nature || "",
    });
    setEditingId(a.id);
    setShowForm(true);
  };

  const cancel = () => { setShowForm(false); setEditingId(null); };

  const save = async () => {
    if (!form.code_avantage) {
      toast.error("Veuillez sélectionner une rubrique d'avantage");
      return;
    }
    if (!form.valeur_monetaire) {
      toast.error("Le montant est obligatoire");
      return;
    }
    if (!form.date_debut) {
      toast.error("La date de début est obligatoire");
      return;
    }

    // Vérifier s'il existe déjà un avantage en cours avec la même rubrique
    const existing = avantages.filter(
      a => a.code_avantage === form.code_avantage && isEnCours(a) && a.id !== editingId
    );
    if (existing.length > 0) {
      toast.error("Un avantage en cours existe déjà pour cette rubrique. Veuillez d'abord clôturer l'existant.");
      return;
    }

    setSaving(true);
    const payload: any = {
      collaborateur_id: collaborateurId,
      code_avantage: form.code_avantage,
      valeur_monetaire: parseFloat(form.valeur_monetaire),
      date_debut: form.date_debut,
      date_fin: form.date_fin || null,
      est_brut: form.est_brut === "true",
      valeur_nature: form.valeur_nature || null,
    };

    if (editingId) {
      const { error } = await supabase.from("collaborateur_avantages").update(payload).eq("id", editingId);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Avantage mis à jour");
    } else {
      const { error } = await supabase.from("collaborateur_avantages").insert(payload);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Avantage ajouté");
    }
    setSaving(false);
    setShowForm(false);
    setEditingId(null);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Archiver cet avantage ?")) return;
    await supabase.from("collaborateur_avantages").update({ archive: true } as any).eq("id", id);
    toast.success("Avantage archivé");
    load();
  };

  const fmt = (v?: number | null) =>
    v != null ? new Intl.NumberFormat("fr-MA", { minimumFractionDigits: 2 }).format(v) : "—";

  const inputStyle = "w-full px-2 py-1.5 rounded-md border text-xs border-border bg-background text-foreground";

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-accent" /></div>;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Award size={15} className="text-accent" />
          <h3 className="font-semibold text-sm text-foreground">Avantages</h3>
        </div>
        {!readOnly && !showForm && (
          <button onClick={openNew} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-white">
            <Plus size={12} /> Nouveau
          </button>
        )}
      </div>

      {/* Formulaire */}
      {showForm && (
        <div className="rounded-xl border border-border p-4 mb-4 bg-card">
          <h4 className="text-xs font-semibold text-foreground mb-3">
            {editingId ? "Modifier l'avantage" : "Nouvel avantage"}
          </h4>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
            {/* Rubrique avantage */}
            <div className="col-span-2">
              <label className="block text-[11px] font-medium text-muted-foreground mb-0.5">Rubrique avantage *</label>
              <select
                value={form.code_avantage}
                onChange={e => setForm(f => ({ ...f, code_avantage: e.target.value }))}
                className={inputStyle}
              >
                <option value="">— Sélectionner —</option>
                {/* RG-AVT-03 : Affichage du libellé uniquement (sans code rubrique) – Auteur : Adil DAIA */}
                {rubriques.map(r => (
                  <option key={r.code} value={r.code}>{r.libelle}</option>
                ))}
              </select>
            </div>

            {/* Montant */}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-0.5">Montant *</label>
              <input
                type="number" step="0.01"
                value={form.valeur_monetaire}
                onChange={e => setForm(f => ({ ...f, valeur_monetaire: e.target.value }))}
                className={inputStyle}
              />
            </div>

            {/* Brut / Net */}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-0.5">Type montant</label>
              <select
                value={form.est_brut}
                onChange={e => setForm(f => ({ ...f, est_brut: e.target.value }))}
                className={inputStyle}
              >
                <option value="true">Brut</option>
                <option value="false">Net</option>
              </select>
            </div>

            {/* Date début */}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-0.5">Date début *</label>
              <input type="date" value={form.date_debut}
                onChange={e => setForm(f => ({ ...f, date_debut: e.target.value }))}
                className={inputStyle} />
            </div>

            {/* Date fin */}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-0.5">Date fin</label>
              <input type="date" value={form.date_fin}
                onChange={e => setForm(f => ({ ...f, date_fin: e.target.value }))}
                className={inputStyle} />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 justify-end">
            <button onClick={cancel} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-border font-semibold text-muted-foreground">
              <X size={13} /> Annuler
            </button>
            <button onClick={save} disabled={saving} className="flex items-center gap-1 text-xs px-4 py-1.5 rounded-lg font-semibold bg-accent text-white">
              <Save size={13} /> {saving ? "…" : "Enregistrer"}
            </button>
          </div>
        </div>
      )}

      {/* Liste */}
      {avantages.length === 0 ? (
        <p className="text-sm text-center py-6 text-muted-foreground">Aucun avantage enregistré</p>
      ) : (
        avantages.map(a => (
          <div key={a.id} className={`rounded-xl border p-3 mb-2 ${isEnCours(a) ? "border-accent/30 bg-accent/5" : "border-border bg-muted/30"}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-foreground">{getRubriqueLabel(a.code_avantage)}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${isEnCours(a) ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                  {isEnCours(a) ? "En cours" : "Terminé"}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${a.est_brut ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>
                  {a.est_brut ? "Brut" : "Net"}
                </span>
              </div>
              {!readOnly && (
                <div className="flex items-center gap-1">
                  <button onClick={() => openEdit(a)} className="p-1.5 rounded hover:bg-muted" title="Modifier">
                    <Pencil size={13} className="text-muted-foreground" />
                  </button>
                  <button onClick={() => remove(a.id)} className="p-1.5 rounded hover:bg-muted" title="Archiver">
                    <Trash2 size={13} className="text-destructive" />
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[11px] text-muted-foreground">Montant</p>
                <p className="text-sm font-bold text-primary">{fmt(a.valeur_monetaire)}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Début</p>
                <p className="text-xs text-foreground">{a.date_debut ? new Date(a.date_debut).toLocaleDateString("fr-FR") : "—"}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Fin</p>
                <p className="text-xs text-foreground">{a.date_fin ? new Date(a.date_fin).toLocaleDateString("fr-FR") : "—"}</p>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export default AvantageForm;
