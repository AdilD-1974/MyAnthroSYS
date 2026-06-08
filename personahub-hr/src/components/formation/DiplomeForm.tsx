import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GraduationCap, Plus, Pencil, Trash2, Save, X, Check } from "lucide-react";
import RefSelect from "@/components/RefSelect";
import { toast } from "sonner";

interface Diplome {
  id: string;
  collaborateur_id: string;
  code_diplome: string;
  intitule_diplome: string | null;
  etablissement: string | null;
  code_type_etab: string | null;
  date_obtention: string | null;
  diplome_recrutement: boolean;
  est_certification: boolean;
  validite_jusqu_a: string | null;
  code_filiere_diplome: string | null;
  code_specialite_diplome: string | null;
  code_niveau_diplome: string | null;
  formation_interne: boolean;
  archive: boolean;
}

const EMPTY: Omit<Diplome, "id" | "collaborateur_id" | "archive"> = {
  code_diplome: "",
  intitule_diplome: "",
  etablissement: "",
  code_type_etab: "",
  date_obtention: "",
  diplome_recrutement: false,
  est_certification: false,
  validite_jusqu_a: "",
  code_filiere_diplome: "",
  code_specialite_diplome: "",
  code_niveau_diplome: "",
  formation_interne: false,
};

interface Props {
  collaborateurId: string;
}

const DiplomeForm: React.FC<Props> = ({ collaborateurId }) => {
  const [diplomes, setDiplomes] = useState<Diplome[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);

  // Ref labels
  const [refDiplomes, setRefDiplomes] = useState<Record<string, string>>({});
  const [refDiplomeNiveau, setRefDiplomeNiveau] = useState<Record<string, string>>({});
  const [refFilieres, setRefFilieres] = useState<Record<string, string>>({});
  const [refSpecialites, setRefSpecialites] = useState<Record<string, string>>({});
  const [refSpecialiteFiliere, setRefSpecialiteFiliere] = useState<Record<string, string>>({});
  const [refNiveaux, setRefNiveaux] = useState<Record<string, string>>({});
  const [refNiveauxRang, setRefNiveauxRang] = useState<Record<string, number>>({});
  const [refNiveauxAnnees, setRefNiveauxAnnees] = useState<Record<string, number | null>>({});
  const [refTypeEtabs, setRefTypeEtabs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("collaborateur_diplomes")
      .select("*")
      .eq("collaborateur_id", collaborateurId)
      .eq("archive", false)
      .order("date_obtention", { ascending: false });
    if (data) setDiplomes(data as any);
  }, [collaborateurId]);

  useEffect(() => { load(); }, [load]);

  // Load ref labels
  useEffect(() => {
    const loadRef = async (table: string, setter: (v: Record<string, string>) => void) => {
      const { data } = await supabase
        .from(table as never)
        .select("code, libelle")
        .eq("actif" as never, true as never);
      if (data) {
        const map: Record<string, string> = {};
        (data as any[]).forEach(r => { map[r.code] = r.libelle; });
        setter(map);
      }
    };
    loadRef("ref_filiere_diplome", setRefFilieres);
    loadRef("ref_type_etablissement", setRefTypeEtabs);

    // Load diplômes référence avec leur niveau lié
    (async () => {
      const { data } = await supabase
        .from("ref_type_diplome")
        .select("code, libelle, code_niveau_diplome")
        .eq("actif", true);
      if (data) {
        const mapLabel: Record<string, string> = {};
        const mapNiveau: Record<string, string> = {};
        (data as any[]).forEach(r => {
          mapLabel[r.code] = r.libelle;
          if (r.code_niveau_diplome) mapNiveau[r.code] = r.code_niveau_diplome;
        });
        setRefDiplomes(mapLabel);
        setRefDiplomeNiveau(mapNiveau);
      }
    })();

    // Load spécialités avec leur filière
    (async () => {
      const { data } = await supabase
        .from("ref_specialite_diplome")
        .select("code, libelle, code_filiere")
        .eq("actif", true);
      if (data) {
        const mapLabel: Record<string, string> = {};
        const mapFiliere: Record<string, string> = {};
        (data as any[]).forEach(r => { mapLabel[r.code] = r.libelle; mapFiliere[r.code] = r.code_filiere || ""; });
        setRefSpecialites(mapLabel);
        setRefSpecialiteFiliere(mapFiliere);
      }
    })();

    // Load niveaux with rang
    (async () => {
      const { data } = await supabase
        .from("ref_niveau_diplome")
        .select("code, libelle, rang, nombre_annees")
        .eq("actif", true);
      if (data) {
        const mapLabel: Record<string, string> = {};
        const mapRang: Record<string, number> = {};
        const mapAnnees: Record<string, number | null> = {};
        (data as any[]).forEach(r => { mapLabel[r.code] = r.libelle; mapRang[r.code] = r.rang ?? 0; mapAnnees[r.code] = r.nombre_annees; });
        setRefNiveaux(mapLabel);
        setRefNiveauxRang(mapRang);
        setRefNiveauxAnnees(mapAnnees);
      }
    })();
  }, []);

  // Auto-populate niveau when diplôme référence changes
  const handleDiplomeChange = (code: string) => {
    setForm(f => {
      const niveauFromRef = refDiplomeNiveau[code] || "";
      return { ...f, code_diplome: code, code_niveau_diplome: niveauFromRef || f.code_niveau_diplome };
    });
  };

  const handleSave = async () => {
    if (!form.code_diplome) { toast.error("Le diplôme est obligatoire"); return; }
    // Validation des dates
    if (form.date_obtention && (form.date_obtention < "1950-01-01" || form.date_obtention > "2099-12-31")) {
      toast.error("Date d'obtention invalide"); return;
    }
    if (form.validite_jusqu_a && (form.validite_jusqu_a < "1950-01-01" || form.validite_jusqu_a > "2099-12-31")) {
      toast.error("Date de validité invalide"); return;
    }
    const payload = {
      collaborateur_id: collaborateurId,
      code_diplome: form.code_diplome,
      intitule_diplome: form.intitule_diplome || null,
      etablissement: form.etablissement || null,
      code_type_etab: form.code_type_etab || null,
      date_obtention: form.date_obtention || null,
      diplome_recrutement: form.diplome_recrutement,
      est_certification: form.est_certification,
      validite_jusqu_a: form.validite_jusqu_a || null,
      code_filiere_diplome: form.code_filiere_diplome || null,
      code_specialite_diplome: form.code_specialite_diplome || null,
      code_niveau_diplome: form.code_niveau_diplome || null,
      formation_interne: form.formation_interne,
    };

    if (editId) {
      const { error } = await supabase.from("collaborateur_diplomes").update(payload as any).eq("id", editId);
      if (error) { toast.error(error.message); return; }
      toast.success("Diplôme mis à jour");
    } else {
      const { error } = await supabase.from("collaborateur_diplomes").insert(payload as any);
      if (error) { toast.error(error.message); return; }
      toast.success("Diplôme ajouté");
    }
    setEditId(null);
    setAdding(false);
    setForm(EMPTY);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer ce diplôme ?")) return;
    await supabase.from("collaborateur_diplomes").update({ archive: true } as any).eq("id", id);
    toast.success("Diplôme archivé");
    load();
  };

  const startEdit = (d: Diplome) => {
    setEditId(d.id);
    setAdding(false);
    setForm({
      code_diplome: d.code_diplome,
      intitule_diplome: d.intitule_diplome || "",
      etablissement: d.etablissement || "",
      code_type_etab: d.code_type_etab || "",
      date_obtention: d.date_obtention || "",
      diplome_recrutement: d.diplome_recrutement,
      est_certification: d.est_certification,
      validite_jusqu_a: d.validite_jusqu_a || "",
      code_filiere_diplome: d.code_filiere_diplome || "",
      code_specialite_diplome: d.code_specialite_diplome || "",
      code_niveau_diplome: d.code_niveau_diplome || "",
      formation_interne: d.formation_interne,
    });
  };

  const cancel = () => { setEditId(null); setAdding(false); setForm(EMPTY); };

  const isEditing = adding || editId;

  const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString("fr-FR") : "—";

  const formFields = (
    <div className="space-y-4 p-4 rounded-lg border" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.2)" }}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Intitulé libre AVANT diplôme référence */}
        <div className="lg:col-span-2">
          <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Intitulé du diplôme</label>
          <input type="text" value={form.intitule_diplome || ""} onChange={e => setForm(f => ({ ...f, intitule_diplome: e.target.value }))}
            placeholder="Ex: Master en Informatique Appliquée"
            className="w-full px-3 py-2 rounded-lg border text-sm"
            style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", height: 38 }} />
        </div>
        <RefSelect table="ref_type_diplome" value={form.code_diplome} onChange={handleDiplomeChange} label="Diplôme Référence *" required />
        <RefSelect table="ref_filiere_diplome" value={form.code_filiere_diplome || ""} onChange={v => setForm(f => ({ ...f, code_filiere_diplome: v, code_specialite_diplome: "" }))} label="Filière" />
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Spécialité</label>
          <select
            value={form.code_specialite_diplome || ""}
            onChange={e => {
              const newSpec = e.target.value;
              // Auto-remplir la filière depuis la spécialité choisie
              const filiereAuto = newSpec ? (refSpecialiteFiliere[newSpec] || "") : "";
              setForm(f => ({
                ...f,
                code_specialite_diplome: newSpec,
                // On ne remplace la filière que si la spécialité a une filière définie
                code_filiere_diplome: filiereAuto || f.code_filiere_diplome,
              }));
            }}
            className="w-full px-3 py-2 rounded-lg border text-sm"
            style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", height: 38 }}
          >
            <option value="">— Sélectionner —</option>
            {Object.entries(refSpecialites)
              .filter(([code]) => !form.code_filiere_diplome || refSpecialiteFiliere[code] === form.code_filiere_diplome)
              .map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
          </select>
        </div>
        <RefSelect table="ref_niveau_diplome" value={form.code_niveau_diplome || ""} onChange={v => setForm(f => ({ ...f, code_niveau_diplome: v }))} label="Niveau" />
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Établissement</label>
          <input type="text" value={form.etablissement || ""} onChange={e => setForm(f => ({ ...f, etablissement: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border text-sm"
            style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", height: 38 }} />
        </div>
        <RefSelect table="ref_type_etablissement" value={form.code_type_etab || ""} onChange={v => setForm(f => ({ ...f, code_type_etab: v }))} label="Type établissement" />
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Date obtention</label>
          <input type="date" value={form.date_obtention || ""} onChange={e => setForm(f => ({ ...f, date_obtention: e.target.value }))}
            min="1950-01-01" max="2099-12-31"
            className="w-full px-3 py-2 rounded-lg border text-sm"
            style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", height: 38 }} />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Validité jusqu'au</label>
          <input type="date" value={form.validite_jusqu_a || ""} onChange={e => setForm(f => ({ ...f, validite_jusqu_a: e.target.value }))}
            min="1950-01-01" max="2099-12-31"
            className="w-full px-3 py-2 rounded-lg border text-sm"
            style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", height: 38 }} />
        </div>
      </div>
      <div className="flex flex-wrap gap-6 pt-2">
        {[
          { key: "diplome_recrutement", label: "Diplôme de recrutement" },
          { key: "est_certification", label: "Certification" },
          { key: "formation_interne", label: "Formation interne" },
        ].map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: "hsl(var(--foreground))" }}>
            <button type="button" onClick={() => setForm(f => ({ ...f, [key]: !(f as any)[key] }))}
              className="w-5 h-5 rounded border flex items-center justify-center transition-colors"
              style={{
                borderColor: (form as any)[key] ? "hsl(var(--accent))" : "hsl(var(--border))",
                background: (form as any)[key] ? "hsl(var(--accent))" : "transparent",
              }}>
              {(form as any)[key] && <Check size={12} style={{ color: "white" }} />}
            </button>
            {label}
          </label>
        ))}
      </div>
      <div className="flex gap-2 pt-2">
        <button onClick={handleSave} className="flex items-center gap-1 px-4 py-2 rounded-lg text-xs font-semibold" style={{ background: "hsl(var(--accent))", color: "white" }}>
          <Save size={13} />{editId ? "Mettre à jour" : "Enregistrer"}
        </button>
        <button onClick={cancel} className="flex items-center gap-1 px-4 py-2 rounded-lg text-xs font-semibold border" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
          <X size={13} />Annuler
        </button>
      </div>
    </div>
  );

  return (
    <div className="rounded-xl border p-5 mb-4" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <GraduationCap size={15} style={{ color: "hsl(var(--accent))" }} />
          <h3 className="text-sm font-bold" style={{ color: "hsl(var(--foreground))" }}>Diplômes & Certifications</h3>
        </div>
        {!isEditing && (
          <button onClick={() => { setAdding(true); setForm(EMPTY); }} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "hsl(var(--accent))", color: "white" }}>
            <Plus size={12} />Ajouter
          </button>
        )}
      </div>

      {adding && formFields}

      {diplomes.length === 0 && !adding ? (
        <p className="text-sm text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun diplôme enregistré</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          {diplomes.map(d => (
            editId === d.id ? (
              <div key={d.id} className="col-span-full">{formFields}</div>
            ) : (
              <div key={d.id} className="rounded-lg p-4 border" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    {d.intitule_diplome && (
                      <span className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>{d.intitule_diplome}</span>
                    )}
                    <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                      Réf : {refDiplomes[d.code_diplome] || d.code_diplome}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap justify-end">
                    {d.est_certification && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--accent) / 0.15)", color: "hsl(var(--accent))" }}>Certification</span>}
                    {d.diplome_recrutement && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "hsl(84 55% 50% / 0.15)", color: "hsl(84 55% 35%)" }}>Recrutement</span>}
                    {d.formation_interne && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "hsl(200 70% 50% / 0.15)", color: "hsl(200 70% 35%)" }}>Formation interne</span>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                  <div>
                    <span style={{ color: "hsl(var(--muted-foreground))" }}>Filière : </span>
                    <span style={{ color: "hsl(var(--foreground))" }}>{d.code_filiere_diplome ? (refFilieres[d.code_filiere_diplome] || d.code_filiere_diplome) : "—"}</span>
                  </div>
                  <div>
                    <span style={{ color: "hsl(var(--muted-foreground))" }}>Spécialité : </span>
                    <span style={{ color: "hsl(var(--foreground))" }}>{d.code_specialite_diplome ? (refSpecialites[d.code_specialite_diplome] || d.code_specialite_diplome) : "—"}</span>
                  </div>
                  <div>
                    <span style={{ color: "hsl(var(--muted-foreground))" }}>Niveau : </span>
                    <span style={{ color: "hsl(var(--foreground))" }}>
                      {d.code_niveau_diplome ? (
                        <>
                          {refNiveaux[d.code_niveau_diplome] || d.code_niveau_diplome}
                          {refNiveauxRang[d.code_niveau_diplome] != null && (
                            <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold" style={{ background: "hsl(var(--accent) / 0.15)", color: "hsl(var(--accent))" }}>
                              {refNiveauxRang[d.code_niveau_diplome]}
                            </span>
                          )}
                          {refNiveauxAnnees[d.code_niveau_diplome] != null && (
                            <span className="ml-1 text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                              ({refNiveauxAnnees[d.code_niveau_diplome]} an{(refNiveauxAnnees[d.code_niveau_diplome] ?? 0) > 1 ? "s" : ""})
                            </span>
                          )}
                        </>
                      ) : "—"}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: "hsl(var(--muted-foreground))" }}>Établissement : </span>
                    <span style={{ color: "hsl(var(--foreground))" }}>{d.etablissement || "—"}</span>
                  </div>
                  <div>
                    <span style={{ color: "hsl(var(--muted-foreground))" }}>Type étab. : </span>
                    <span style={{ color: "hsl(var(--foreground))" }}>{d.code_type_etab ? (refTypeEtabs[d.code_type_etab] || d.code_type_etab) : "—"}</span>
                  </div>
                  <div>
                    <span style={{ color: "hsl(var(--muted-foreground))" }}>Date obtention : </span>
                    <span style={{ color: "hsl(var(--foreground))" }}>{fmtDate(d.date_obtention)}</span>
                  </div>
                  {d.validite_jusqu_a && (
                    <div>
                      <span style={{ color: "hsl(var(--muted-foreground))" }}>Validité : </span>
                      <span style={{ color: "hsl(var(--foreground))" }}>{fmtDate(d.validite_jusqu_a)}</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-1 justify-end">
                  <button onClick={() => startEdit(d)} className="p-1.5 rounded hover:bg-muted" title="Modifier">
                    <Pencil size={13} style={{ color: "hsl(var(--accent))" }} />
                  </button>
                  <button onClick={() => handleDelete(d.id)} className="p-1.5 rounded hover:bg-muted" title="Supprimer">
                    <Trash2 size={13} style={{ color: "hsl(0 84% 55%)" }} />
                  </button>
                </div>
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
};

export default DiplomeForm;
