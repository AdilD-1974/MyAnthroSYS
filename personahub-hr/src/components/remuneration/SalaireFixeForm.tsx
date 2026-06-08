/**
 * SalaireFixeForm – Formulaire CRUD pour les éléments fixes du salaire d'un collaborateur.
 */
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, X, Save, CreditCard, Loader2 } from "lucide-react";
import { useZoneFixeLabels } from "@/hooks/useZoneFixeLabels";

interface SalaireFixe {
  id: string;
  collaborateur_id: string;
  date_debut: string;
  date_fin: string | null;
  salaire_base: number;
  salaire_horaire: number | null;
  salaire_journalier: number | null;
  prime_anciennete: number | null;
  prime_logement: number | null;
  prime_transport: number | null;
  indemnite_fonction: number | null;
  indemnite_representation: number | null;
  indemnite_caisse: number | null;
  indemnite_risque: number | null;
  indemnite_telephone: number | null;
  allocation_familiale: number | null;
  zone_fixe_01: number | null; zone_fixe_02: number | null; zone_fixe_03: number | null;
  zone_fixe_04: number | null; zone_fixe_05: number | null; zone_fixe_06: number | null;
  zone_fixe_07: number | null; zone_fixe_08: number | null; zone_fixe_09: number | null;
  zone_fixe_10: number | null; zone_fixe_11: number | null; zone_fixe_12: number | null;
  zone_fixe_13: number | null; zone_fixe_14: number | null; zone_fixe_15: number | null;
  zone_fixe_16: number | null; zone_fixe_17: number | null; zone_fixe_18: number | null;
  zone_fixe_19: number | null; zone_fixe_20: number | null;
  decision_ref: string | null;
  commentaire: string | null;
  archive: boolean;
}

const ALL_ZONE_KEYS = [
  "zone_fixe_01", "zone_fixe_02", "zone_fixe_03", "zone_fixe_04", "zone_fixe_05",
  "zone_fixe_06", "zone_fixe_07", "zone_fixe_08", "zone_fixe_09", "zone_fixe_10",
  "zone_fixe_11", "zone_fixe_12", "zone_fixe_13", "zone_fixe_14", "zone_fixe_15",
  "zone_fixe_16", "zone_fixe_17", "zone_fixe_18", "zone_fixe_19", "zone_fixe_20",
] as const;

const EMPTY_FORM: Record<string, string> = {
  date_debut: "", date_fin: "", salaire_base: "",
  salaire_horaire: "", salaire_journalier: "",
  prime_anciennete: "", prime_logement: "", prime_transport: "",
  indemnite_fonction: "", indemnite_representation: "",
  indemnite_caisse: "", indemnite_risque: "", indemnite_telephone: "",
  allocation_familiale: "",
  ...Object.fromEntries(ALL_ZONE_KEYS.map(k => [k, ""])),
  decision_ref: "", commentaire: "",
};

const FIELDS_STATIC: { key: string; label: string; type: "number" | "date" | "text" }[] = [
  // Salaire de base / horaire / journalier sont rendus séparément (règle XOR)
  { key: "prime_anciennete", label: "Prime ancienneté", type: "number" },
  { key: "prime_logement", label: "Prime logement", type: "number" },
  { key: "prime_transport", label: "Prime transport", type: "number" },
  { key: "indemnite_fonction", label: "Ind. fonction", type: "number" },
  { key: "indemnite_representation", label: "Ind. représentation", type: "number" },
  { key: "indemnite_caisse", label: "Ind. caisse", type: "number" },
  { key: "indemnite_risque", label: "Ind. risque", type: "number" },
  { key: "indemnite_telephone", label: "Ind. téléphone", type: "number" },
  { key: "allocation_familiale", label: "Alloc. familiale", type: "number" },
];

interface Props {
  collaborateurId: string;
  readOnly?: boolean;
}

const SalaireFixeForm: React.FC<Props> = ({ collaborateurId, readOnly = false }) => {
  const [salaires, setSalaires] = useState<SalaireFixe[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [dateDebutContrat, setDateDebutContrat] = useState<string>("");
  const { labels: zoneLabels } = useZoneFixeLabels();

  // Only show zones linked to a rubrique
  const activeZoneFields = useMemo(() => {
    return ALL_ZONE_KEYS
      .filter(k => !!zoneLabels[k])
      .map(k => ({ key: k, label: zoneLabels[k], type: "number" as const }));
  }, [zoneLabels]);

  const FIELDS = useMemo(() => [...FIELDS_STATIC, ...activeZoneFields], [activeZoneFields]);

  // Load date début du contrat en cours
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("collaborateur_contrats")
        .select("date_debut")
        .eq("collaborateur_id", collaborateurId)
        .eq("archive", false)
        .in("code_statut_contrat", ["ACTIF", "EN_COURS"])
        .order("date_debut", { ascending: false })
        .limit(1);
      if (data && (data as any[]).length > 0) {
        setDateDebutContrat((data as any[])[0].date_debut || "");
      }
    })();
  }, [collaborateurId]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("collaborateur_salaires_fixes" as any)
      .select("*")
      .eq("collaborateur_id", collaborateurId)
      .eq("archive", false)
      .order("date_debut", { ascending: false });
    setSalaires((data || []) as SalaireFixe[]);
    setLoading(false);
  }, [collaborateurId]);

  useEffect(() => { load(); }, [load]);

  const fmt = (v?: number | null) =>
    v != null ? new Intl.NumberFormat("fr-MA", { minimumFractionDigits: 2 }).format(v) : "—";

  const isFirstOccurrence = salaires.length === 0;

  const openNew = () => {
    setForm({ ...EMPTY_FORM, date_debut: isFirstOccurrence ? dateDebutContrat : "" });
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (s: SalaireFixe) => {
    const f: Record<string, string> = {
      date_debut: s.date_debut || "",
      date_fin: s.date_fin || "",
      salaire_base: s.salaire_base != null ? String(s.salaire_base) : "",
      salaire_horaire: s.salaire_horaire != null ? String(s.salaire_horaire) : "",
      salaire_journalier: s.salaire_journalier != null ? String(s.salaire_journalier) : "",
      prime_anciennete: s.prime_anciennete != null ? String(s.prime_anciennete) : "",
      prime_logement: s.prime_logement != null ? String(s.prime_logement) : "",
      prime_transport: s.prime_transport != null ? String(s.prime_transport) : "",
      indemnite_fonction: s.indemnite_fonction != null ? String(s.indemnite_fonction) : "",
      indemnite_representation: s.indemnite_representation != null ? String(s.indemnite_representation) : "",
      indemnite_caisse: s.indemnite_caisse != null ? String(s.indemnite_caisse) : "",
      indemnite_risque: s.indemnite_risque != null ? String(s.indemnite_risque) : "",
      indemnite_telephone: s.indemnite_telephone != null ? String(s.indemnite_telephone) : "",
      allocation_familiale: s.allocation_familiale != null ? String(s.allocation_familiale) : "",
      decision_ref: s.decision_ref || "",
      commentaire: s.commentaire || "",
    };
    for (const k of ALL_ZONE_KEYS) {
      f[k] = (s as any)[k] != null ? String((s as any)[k]) : "";
    }
    setForm(f);
    setEditingId(s.id);
    setShowForm(true);
  };

  const cancel = () => { setShowForm(false); setEditingId(null); };
  const toNum = (v: string) => v ? parseFloat(v) : null;

  const save = async () => {
    const effectiveDate = form.date_debut || dateDebutContrat;
    if (!effectiveDate) {
      toast.error("La date de début est obligatoire");
      return;
    }
    // RG-SAL-XOR-01 : exactement UN parmi salaire_base / horaire / journalier
    const filled = [form.salaire_base, form.salaire_horaire, form.salaire_journalier]
      .filter(v => v && parseFloat(v) > 0);
    if (filled.length === 0) {
      toast.error("Renseigner un salaire de base, horaire OU journalier (au choix)");
      return;
    }
    if (filled.length > 1) {
      toast.error("Un seul des 3 champs (base, horaire, journalier) peut être saisi");
      return;
    }
    setSaving(true);
    const payload: any = {
      collaborateur_id: collaborateurId,
      date_debut: effectiveDate,
      date_fin: form.date_fin || null,
      salaire_base: parseFloat(form.salaire_base),
      salaire_horaire: toNum(form.salaire_horaire),
      salaire_journalier: toNum(form.salaire_journalier),
      prime_anciennete: toNum(form.prime_anciennete),
      prime_logement: toNum(form.prime_logement),
      prime_transport: toNum(form.prime_transport),
      indemnite_fonction: toNum(form.indemnite_fonction),
      indemnite_representation: toNum(form.indemnite_representation),
      indemnite_caisse: toNum(form.indemnite_caisse),
      indemnite_risque: toNum(form.indemnite_risque),
      indemnite_telephone: toNum(form.indemnite_telephone),
      allocation_familiale: toNum(form.allocation_familiale),
      decision_ref: form.decision_ref || null,
      commentaire: form.commentaire || null,
    };
    for (const k of ALL_ZONE_KEYS) {
      payload[k] = toNum(form[k]);
    }

    if (editingId) {
      const { error } = await supabase.from("collaborateur_salaires_fixes").update(payload).eq("id", editingId);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Salaire fixe mis à jour");
    } else {
      const { error } = await supabase.from("collaborateur_salaires_fixes").insert(payload);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Salaire fixe ajouté");
    }
    setSaving(false);
    setShowForm(false);
    setEditingId(null);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Archiver cet enregistrement de salaire fixe ?")) return;
    await supabase.from("collaborateur_salaires_fixes").update({ archive: true } as any).eq("id", id);
    toast.success("Salaire fixe archivé");
    load();
  };

  const inputStyle = "w-full px-2 py-1.5 rounded-md border text-xs border-border bg-background text-foreground";

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-accent" /></div>;

  return (
    <div>
      {/* Header retiré : le titre "Éléments fixes du salaire" est déjà affiché par le SectionCard parent dans FicheCollaborateur.tsx */}
      {!readOnly && !showForm && (
        <div className="flex justify-end mb-4">
          <button onClick={openNew} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-white">
            <Plus size={12} /> Nouveau
          </button>
        </div>
      )}

      {/* Formulaire */}
      {showForm && (
        <div className="rounded-xl border border-border p-4 mb-4 bg-card">
          <h4 className="text-xs font-semibold text-foreground mb-3">
            {editingId ? "Modifier le salaire fixe" : "Nouveau salaire fixe"}
          </h4>

          {/* Dates & Réf décision */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-0.5">Date début *</label>
              <input type="date" value={form.date_debut} onChange={e => setForm(f => ({ ...f, date_debut: e.target.value }))}
                placeholder={dateDebutContrat || ""}
                className={inputStyle} />
              {!editingId && isFirstOccurrence && dateDebutContrat && (
                <p className="text-[10px] text-accent mt-0.5 flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent" />
                  Préremplie avec la date début du contrat en cours ({new Date(dateDebutContrat).toLocaleDateString("fr-FR")})
                </p>
              )}
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-0.5">Date fin</label>
              <input type="date" value={form.date_fin} onChange={e => setForm(f => ({ ...f, date_fin: e.target.value }))}
                className={inputStyle} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-0.5">Réf. décision</label>
              <input type="text" value={form.decision_ref} onChange={e => setForm(f => ({ ...f, decision_ref: e.target.value }))}
                className={inputStyle} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-0.5">Commentaire</label>
              <input type="text" value={form.commentaire} onChange={e => setForm(f => ({ ...f, commentaire: e.target.value }))}
                className={inputStyle} />
            </div>
          </div>

          {/* Salaire de base / horaire / journalier — règle XOR (un seul au choix) */}
          <div className="rounded-lg border-2 p-3 mb-3"
            style={{ borderColor: "hsl(var(--accent) / 0.3)", background: "hsl(var(--accent) / 0.04)" }}>
            <p className="text-[11px] font-semibold mb-2"
              style={{ color: "hsl(var(--accent))" }}>
              Type de rémunération * — choisir <strong>un seul</strong> mode parmi les 3 :
            </p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: "salaire_base", label: "Salaire de base" },
                { key: "salaire_horaire", label: "Salaire horaire" },
                { key: "salaire_journalier", label: "Salaire journalier" },
              ].map(opt => {
                const isThisFilled = form[opt.key] && parseFloat(form[opt.key]) > 0;
                const anotherFilled = ["salaire_base", "salaire_horaire", "salaire_journalier"]
                  .filter(k => k !== opt.key)
                  .some(k => form[k] && parseFloat(form[k]) > 0);
                const disabled = anotherFilled && !isThisFilled;
                return (
                  <div key={opt.key}>
                    <label className="block text-[11px] font-medium mb-0.5"
                      style={{
                        color: disabled ? "hsl(var(--muted-foreground) / 0.5)" : "hsl(var(--foreground))",
                      }}>
                      {opt.label}
                    </label>
                    <input
                      type="number" step="0.01"
                      value={form[opt.key]}
                      disabled={disabled}
                      placeholder={disabled ? "— bloqué —" : "0,00"}
                      onChange={e => setForm(prev => ({ ...prev, [opt.key]: e.target.value }))}
                      className={inputStyle}
                      style={{
                        opacity: disabled ? 0.4 : 1,
                        cursor: disabled ? "not-allowed" : "auto",
                        background: isThisFilled ? "hsl(var(--accent) / 0.08)" : undefined,
                        fontWeight: isThisFilled ? 600 : undefined,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Autres montants (primes, indemnités, zones) */}
          <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-2 mb-3">
            {FIELDS.map(f => (
              <div key={f.key}>
                <label className="block text-[11px] font-medium text-muted-foreground mb-0.5 truncate" title={f.label}>{f.label}</label>
                <input
                  type="number" step="0.01"
                  value={form[f.key]}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  className={inputStyle}
                />
              </div>
            ))}
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
      {salaires.length === 0 ? (
        <p className="text-sm text-center py-6 text-muted-foreground">Aucun salaire fixe enregistré</p>
      ) : (
        salaires.map(s => {
          const isFilled = (v: any) => {
            if (v == null || v === "") return false;
            const n = Number(v);
            return !isNaN(n) && n > 0;
          };
          // Mode de rémunération principal (parmi base/horaire/journalier)
          const modeRem = isFilled(s.salaire_base)
            ? { label: "Salaire de base", value: s.salaire_base }
            : isFilled(s.salaire_horaire)
              ? { label: "Salaire horaire", value: s.salaire_horaire }
              : isFilled(s.salaire_journalier)
                ? { label: "Salaire journalier", value: s.salaire_journalier }
                : null;
          // Autres montants (primes/indemnités/zones) — uniquement ceux remplis
          const autres = [
            { label: "Prime ancienneté", value: s.prime_anciennete },
            { label: "Prime logement", value: s.prime_logement },
            { label: "Prime transport", value: s.prime_transport },
            { label: "Indemnité fonction", value: s.indemnite_fonction },
            { label: "Indemnité représentation", value: s.indemnite_representation },
            { label: "Indemnité caisse", value: s.indemnite_caisse },
            { label: "Indemnité risque", value: s.indemnite_risque },
            { label: "Indemnité téléphone", value: s.indemnite_telephone },
            { label: "Allocation familiale", value: s.allocation_familiale },
            ...ALL_ZONE_KEYS
              .filter(k => !!zoneLabels[k])
              .map(k => ({ label: zoneLabels[k], value: (s as any)[k] as number | null })),
          ].filter(x => isFilled(x.value));
          // Total = mode + tous les autres
          const total = (modeRem?.value || 0) + autres.reduce((sum, x) => sum + Number(x.value || 0), 0);
          const enCours = !s.date_fin;

          return (
            <div key={s.id} className="rounded-xl overflow-hidden mb-3"
              style={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                boxShadow: "0 1px 2px hsl(var(--foreground) / 0.03)",
              }}>
              {/* ─ Header : période + statut + actions ────────────────────── */}
              <div className="flex items-center justify-between px-5 py-3"
                style={{ borderBottom: "1px solid hsl(var(--border) / 0.5)", background: "hsl(var(--muted) / 0.3)" }}>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold"
                    style={{ color: "hsl(var(--foreground))" }}>
                    <span style={{ color: "hsl(var(--muted-foreground))" }}>Du</span>
                    {s.date_debut ? new Date(s.date_debut).toLocaleDateString("fr-FR") : "—"}
                    <span style={{ color: "hsl(var(--muted-foreground))" }}>au</span>
                    {s.date_fin
                      ? new Date(s.date_fin).toLocaleDateString("fr-FR")
                      : <em style={{ fontStyle: "normal", color: "hsl(var(--muted-foreground))" }}>—</em>}
                  </span>
                  {enCours && (
                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider"
                      style={{ background: "hsl(142 70% 45% / 0.15)", color: "hsl(142 70% 38%)" }}>
                      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "hsl(142 70% 38%)" }} />
                      En cours
                    </span>
                  )}
                  {s.decision_ref && (
                    <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                      Réf. décision : <span style={{ color: "hsl(var(--foreground))", fontWeight: 600 }}>{s.decision_ref}</span>
                    </span>
                  )}
                </div>
                {!readOnly && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => openEdit(s)} className="p-1.5 rounded hover:bg-muted transition-colors" title="Modifier">
                      <Pencil size={13} className="text-muted-foreground" />
                    </button>
                    <button onClick={() => remove(s.id)} className="p-1.5 rounded hover:bg-muted transition-colors" title="Archiver">
                      <Trash2 size={13} className="text-destructive" />
                    </button>
                  </div>
                )}
              </div>

              {/* ─ Mode de rémunération principal — mis en évidence ────────── */}
              {modeRem && (
                <div className="px-5 py-3.5 flex items-center justify-between"
                  style={{ borderBottom: "1px solid hsl(var(--border) / 0.4)", background: "hsl(var(--accent) / 0.06)" }}>
                  <span className="text-[13px] font-bold uppercase tracking-wider"
                    style={{ color: "hsl(var(--accent))" }}>
                    {modeRem.label}
                  </span>
                  <span className="text-lg font-bold tabular-nums"
                    style={{ color: "hsl(var(--accent))" }}>
                    {fmt(modeRem.value)}
                  </span>
                </div>
              )}

              {/* ─ Autres montants : tableau aligné label/montant ──────────── */}
              {autres.length > 0 && (
                <div className="px-5 py-2">
                  {autres.map((x, i) => (
                    <div key={x.label}
                      className="flex items-center justify-between py-2"
                      style={{
                        borderBottom: i < autres.length - 1
                          ? "1px solid hsl(var(--border) / 0.3)"
                          : "none",
                      }}>
                      <span className="text-[13px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                        {x.label}
                      </span>
                      <span className="text-[13px] font-semibold tabular-nums"
                        style={{ color: "hsl(var(--foreground))" }}>
                        {fmt(x.value)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* ─ Total ──────────────────────────────────────────────────── */}
              {(modeRem || autres.length > 0) && (
                <div className="px-5 py-3.5 flex items-center justify-between"
                  style={{ borderTop: "1px solid hsl(var(--border) / 0.5)", background: "hsl(var(--muted) / 0.3)" }}>
                  <span className="text-[13px] font-bold uppercase tracking-wider"
                    style={{ color: "hsl(var(--foreground))" }}>
                    Total éléments fixes
                  </span>
                  <span className="text-lg font-bold tabular-nums"
                    style={{ color: "hsl(var(--foreground))" }}>
                    {fmt(total)}
                  </span>
                </div>
              )}

              {s.commentaire && (
                <div className="px-5 py-2.5 text-[11px] italic"
                  style={{ color: "hsl(var(--muted-foreground))", borderTop: "1px solid hsl(var(--border) / 0.3)" }}>
                  « {s.commentaire} »
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

export default SalaireFixeForm;
