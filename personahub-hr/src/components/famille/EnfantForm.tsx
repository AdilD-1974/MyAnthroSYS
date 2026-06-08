import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Pencil, Trash2, Users, Save } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import RefSelect from "@/components/RefSelect";
import { Button } from "@/components/ui/button";

const fmt = (d?: string | null) => d ? new Date(d).toLocaleDateString("fr-FR") : "—";

interface Enfant {
  id: string;
  nom?: string | null;
  prenom: string;
  code_genre: string;
  code_nationalite?: string | null;
  code_statut: string;
  date_naissance: string;
  lieu_naissance?: string | null;
  est_scolarise: boolean;
  date_debut_scolarite?: string | null;
  date_fin_scolarite?: string | null;
  etablissement_scolaire?: string | null;
  niveau_scolaire?: string | null;
  handicap: boolean;
  code_handicap?: string | null;
  est_pris_en_charge: boolean;
  date_fin_prise_en_charge?: string | null;
  couverture_medicale?: string | null;
  date_deces?: string | null;
  observations?: string | null;
}

const EMPTY: Omit<Enfant, "id"> = {
  nom: "", prenom: "", code_genre: "M", code_nationalite: "", code_statut: "ACTIF",
  date_naissance: "", lieu_naissance: "",
  est_scolarise: false, date_debut_scolarite: "", date_fin_scolarite: "",
  etablissement_scolaire: "", niveau_scolaire: "",
  handicap: false, code_handicap: "",
  est_pris_en_charge: false, date_fin_prise_en_charge: "",
  couverture_medicale: "", date_deces: "", observations: "",
};

const STATUT_ENFANT = [
  { value: "ACTIF", label: "Actif" },
  { value: "MAJEUR", label: "Majeur" },
  { value: "DECEDE", label: "Décédé" },
];

const FI: React.FC<{ label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; className?: string }> =
  ({ label, value, onChange, type = "text", required, className }) => (
    <div className={className}>
      <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
        {label}{required && <span style={{ color: "hsl(0 84% 55%)" }}> *</span>}
      </label>
      <input type={type} value={value || ""} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
        style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))", height: 38 }} />
    </div>
  );

const FB: React.FC<{ label: string; value: boolean; onChange: (v: boolean) => void }> = ({ label, value, onChange }) => (
  <div className="flex items-center gap-3">
    <button type="button" onClick={() => onChange(!value)}
      className="w-10 h-5 rounded-full transition-colors relative flex-shrink-0"
      style={{ background: value ? "hsl(var(--accent))" : "hsl(var(--border))" }}>
      <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow-sm"
        style={{ left: value ? "calc(100% - 18px)" : "2px" }} />
    </button>
    <span className="text-sm" style={{ color: "hsl(var(--foreground))" }}>{label}</span>
  </div>
);

const FieldView: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
  <div>
    <p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</p>
    <p className="text-sm" style={{ color: value ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground) / 0.4)" }}>{value || "—"}</p>
  </div>
);

const Badge: React.FC<{ label: string; color?: string }> = ({ label, color = "hsl(var(--accent))" }) => (
  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
    style={{ background: `${color}20`, color }}>
    {label}
  </span>
);

interface Props { collaborateurId: string }

const EnfantForm: React.FC<Props> = ({ collaborateurId }) => {
  const [enfants, setEnfants] = useState<Enfant[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Enfant | null>(null);
  const [form, setForm] = useState<Omit<Enfant, "id">>(EMPTY);
  const [saving, setSaving] = useState(false);
  // Maps de résolution des libellés depuis les référentiels
  const [natMap, setNatMap] = useState<Record<string, string>>({});
  const [genreMap, setGenreMap] = useState<Record<string, string>>({});

  React.useEffect(() => { load(); }, [collaborateurId]);

  React.useEffect(() => {
    // Charger les référentiels nationalité et genre pour l'affichage en lecture
    Promise.all([
      supabase.from("ref_nationalite" as never).select("code, libelle").eq("actif" as never, true as never),
      supabase.from("ref_genre" as never).select("code, libelle").eq("actif" as never, true as never),
    ]).then(([nat, genre]) => {
      const nm: Record<string, string> = {};
      ((nat.data as any[]) || []).forEach((r: any) => { nm[r.code] = r.libelle; });
      setNatMap(nm);
      const gm: Record<string, string> = {};
      ((genre.data as any[]) || []).forEach((r: any) => { gm[r.code] = r.libelle; });
      setGenreMap(gm);
    });
  }, []);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("collaborateur_enfants")
      .select("*")
      .eq("collaborateur_id", collaborateurId)
      .eq("archive", false)
      .order("date_naissance", { ascending: false });
    if (data) setEnfants(data as Enfant[]);
    setLoading(false);
  };

  const openNew = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (e: Enfant) => { setEditing(e); setForm({ ...e }); setOpen(true); };
  const set = (k: keyof typeof EMPTY, v: any) => setForm(f => {
    const updated = { ...f, [k]: v };
    if (k === "date_deces") {
      updated.code_statut = v ? "DECEDE" : (f.code_statut === "DECEDE" ? "ACTIF" : f.code_statut);
    }
    return updated;
  });

  const handleSave = async () => {
    if (!form.prenom.trim() || !form.date_naissance) return;
    setSaving(true);
    const payload = {
      collaborateur_id: collaborateurId,
      nom: form.nom?.trim() || null,
      prenom: form.prenom.trim(),
      code_genre: form.code_genre || "M",
      code_nationalite: form.code_nationalite || null,
      code_statut: form.code_statut || "ACTIF",
      date_naissance: form.date_naissance,
      lieu_naissance: form.lieu_naissance || null,
      est_scolarise: form.est_scolarise,
      date_debut_scolarite: form.est_scolarise ? (form.date_debut_scolarite || null) : null,
      date_fin_scolarite: form.est_scolarise ? (form.date_fin_scolarite || null) : null,
      etablissement_scolaire: form.est_scolarise ? (form.etablissement_scolaire || null) : null,
      niveau_scolaire: form.est_scolarise ? (form.niveau_scolaire || null) : null,
      handicap: form.handicap,
      code_handicap: form.handicap ? (form.code_handicap || null) : null,
      est_pris_en_charge: form.est_pris_en_charge,
      date_fin_prise_en_charge: form.est_pris_en_charge ? (form.date_fin_prise_en_charge || null) : null,
      couverture_medicale: form.couverture_medicale || null,
      date_deces: form.date_deces || null,
      observations: form.observations || null,
    };
    if (editing) {
      await supabase.from("collaborateur_enfants").update(payload).eq("id", editing.id);
    } else {
      await supabase.from("collaborateur_enfants").insert(payload);
    }
    setSaving(false);
    setOpen(false);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Archiver cet enfant ?")) return;
    await supabase.from("collaborateur_enfants").update({ archive: true }).eq("id", id);
    load();
  };

  const calcAge = (dateNaissance: string) => {
    const d = new Date(dateNaissance);
    return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
  };

  return (
    <>
      <div>
        <div className="flex items-center justify-end mb-3">
          <button onClick={openNew}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: "hsl(var(--accent))", color: "white" }}>
            <Plus size={12} />Ajouter
          </button>
        </div>

        {loading
          ? <div className="h-12 flex items-center justify-center"><div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "hsl(var(--accent))", borderTopColor: "transparent" }} /></div>
          : enfants.length === 0
            ? <p className="text-sm text-center py-6" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun enfant enregistré</p>
            : <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {enfants.map(e => (
                  <div key={e.id} className="rounded-xl border p-4" style={{ background: "hsl(var(--muted) / 0.3)", borderColor: "hsl(var(--border))" }}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                          style={{ background: e.code_genre === "F" ? "hsl(330 70% 60% / 0.15)" : "hsl(210 70% 60% / 0.15)", color: e.code_genre === "F" ? "hsl(330 70% 50%)" : "hsl(210 70% 50%)" }}>
                          {e.prenom?.[0]?.toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold text-sm" style={{ color: "hsl(var(--foreground))" }}>{e.prenom} {e.nom || ""}</p>
                          <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                            {fmt(e.date_naissance)} {e.date_naissance ? `(${calcAge(e.date_naissance)} ans)` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="flex gap-1 flex-wrap justify-end">
                          {e.est_scolarise && <Badge label="Scolarisé" color="hsl(210 70% 50%)" />}
                          {e.handicap && <Badge label="Handicap" color="hsl(0 70% 55%)" />}
                          {e.est_pris_en_charge && <Badge label="Pris en charge" color="hsl(var(--accent))" />}
                        </div>
                        <button onClick={() => openEdit(e)} className="p-1.5 rounded hover:bg-accent/10 transition-colors ml-1" style={{ color: "hsl(var(--accent))" }}><Pencil size={13} /></button>
                        <button onClick={() => handleDelete(e.id)} className="p-1.5 rounded hover:bg-red-50 transition-colors" style={{ color: "hsl(0 84% 55%)" }}><Trash2 size={13} /></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <FieldView label="Genre" value={genreMap[e.code_genre] || e.code_genre} />
                      <FieldView label="Nationalité" value={natMap[e.code_nationalite || ""] || e.code_nationalite} />
                      <FieldView label="Lieu naissance" value={e.lieu_naissance} />
                      <FieldView label="Statut" value={e.code_statut} />
                      {e.est_scolarise && <FieldView label="Établissement" value={e.etablissement_scolaire} />}
                      {e.est_scolarise && <FieldView label="Niveau scolaire" value={e.niveau_scolaire} />}
                      {e.couverture_medicale && <FieldView label="Couverture médicale" value={e.couverture_medicale} />}
                    </div>
                  </div>
                ))}
              </div>
        }
      </div>

      {/* Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Modifier — ${editing.prenom} ${editing.nom || ""}` : "Ajouter un enfant"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Identité */}
            <div className="rounded-lg p-3 border" style={{ background: "hsl(var(--muted) / 0.3)", borderColor: "hsl(var(--border))" }}>
              <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: "hsl(var(--accent))" }}>Identité</p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <FI label="Nom" value={form.nom || ""} onChange={v => set("nom", v)} />
                <FI label="Prénom" value={form.prenom} onChange={v => set("prenom", v)} required />
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <FI label="Date de naissance" value={form.date_naissance} onChange={v => set("date_naissance", v)} type="date" required />
                <FI label="Lieu de naissance" value={form.lieu_naissance || ""} onChange={v => set("lieu_naissance", v)} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <RefSelect table="ref_genre"
                  value={form.code_genre} onChange={v => set("code_genre", v)} label="Genre" />
                <RefSelect table="ref_nationalite" value={form.code_nationalite || ""} onChange={v => set("code_nationalite", v)} label="Nationalité" />
                <RefSelect table="" staticOptions={STATUT_ENFANT} value={form.code_statut} onChange={v => set("code_statut", v)} label="Statut" />
              </div>
            </div>

            {/* Scolarité */}
            <div className="rounded-lg p-3 border" style={{ background: "hsl(var(--muted) / 0.3)", borderColor: "hsl(var(--border))" }}>
              <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: "hsl(210 70% 50%)" }}>Scolarité</p>
              <div className="mb-3">
                <FB label="Est scolarisé(e)" value={form.est_scolarise} onChange={v => set("est_scolarise", v)} />
              </div>
              {form.est_scolarise && (
                <div className="grid grid-cols-2 gap-3">
                  <FI label="Établissement scolaire" value={form.etablissement_scolaire || ""} onChange={v => set("etablissement_scolaire", v)} />
                  <FI label="Niveau scolaire" value={form.niveau_scolaire || ""} onChange={v => set("niveau_scolaire", v)} />
                  <FI label="Début scolarité" value={form.date_debut_scolarite || ""} onChange={v => set("date_debut_scolarite", v)} type="date" />
                  <FI label="Fin scolarité" value={form.date_fin_scolarite || ""} onChange={v => set("date_fin_scolarite", v)} type="date" />
                </div>
              )}
            </div>

            {/* Handicap & Prise en charge */}
            <div className="rounded-lg p-3 border" style={{ background: "hsl(var(--muted) / 0.3)", borderColor: "hsl(var(--border))" }}>
              <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: "hsl(0 70% 55%)" }}>Handicap & Prise en charge</p>
              <div className="grid grid-cols-2 gap-4 mb-3">
                <FB label="Handicap" value={form.handicap} onChange={v => set("handicap", v)} />
                <FB label="Est pris en charge" value={form.est_pris_en_charge} onChange={v => set("est_pris_en_charge", v)} />
              </div>
              {form.handicap && (
                <div className="mb-3">
                  <RefSelect
                    table="ref_type_handicap"
                    valueCol="code"
                    labelCol="libelle"
                    value={form.code_handicap || ""}
                    onChange={v => set("code_handicap", v)}
                    label="Type de handicap"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                {form.est_pris_en_charge && (
                  <FI label="Date fin prise en charge" value={form.date_fin_prise_en_charge || ""} onChange={v => set("date_fin_prise_en_charge", v)} type="date" />
                )}
                <FI label="Couverture médicale" value={form.couverture_medicale || ""} onChange={v => set("couverture_medicale", v)} />
              </div>
            </div>

            {/* Divers */}
            <div className="grid grid-cols-2 gap-3">
              <FI label="Date décès" value={form.date_deces || ""} onChange={v => set("date_deces", v)} type="date" />
              <div className="col-span-2">
                <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Observations</label>
                <textarea value={form.observations || ""} onChange={e => set("observations", e.target.value)} rows={2}
                  className="w-full px-3 py-2 rounded-lg border text-sm outline-none resize-none"
                  style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button onClick={handleSave} disabled={saving || !form.prenom.trim() || !form.date_naissance}
              style={{ background: "hsl(var(--accent))", color: "white" }}>
              {saving ? "Enregistrement..." : <><Save size={13} className="mr-1" />Enregistrer</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default EnfantForm;
