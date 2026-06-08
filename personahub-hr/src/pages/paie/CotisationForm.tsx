/**
 * CotisationForm – Formulaire complet de règle de cotisation avec 3 onglets :
 * Règle, Modalités du Calcul, Rubriques Résultat.
 */
import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Check, Loader2, Info } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface Ref { code: string; libelle: string }

interface RegleForm {
  code: string; regime: string; intitule: string; intitule_complet: string;
  a_traiter: boolean; date_debut: string; date_fin: string;
  est_bareme: boolean; cumuler_plafonds_planchers: boolean; date_application: string; taxe: string;
  code_assiette: string; type_assiette: string; nb_paie: string; nb_jours: string;
  trentieme: string; rapport: string; mode_calcul: string;
  code_bareme: string; cle_bareme: string; type_bareme: string;
  assiette_negative_acceptee: boolean; assiette_negative_zero: boolean; prorata_temporis: boolean;
  min_salariale: string; max_salariale: string; min_patronale: string; max_patronale: string;
  archive: boolean;
}

interface Tranche { code_tranche: string; plancher: string; plafond: string; taux_salariale: string; taux_patronale: string }
interface RubriqueResultat { ligne: string; rubrique_salariale: string; rubrique_patronale: string }

const TRANCHES = ["A", "B", "C", "D", "E"];
const LIGNES_RUBRIQUES = ["COTISATION", "TRANCHE_A", "TRANCHE_B", "TRANCHE_C", "TRANCHE_D", "TRANCHE_E", "TAXE"];
const LIGNES_LABELS: Record<string, string> = {
  COTISATION: "Cotisation", TRANCHE_A: "Tranche A", TRANCHE_B: "Tranche B",
  TRANCHE_C: "Tranche C", TRANCHE_D: "Tranche D", TRANCHE_E: "Tranche E", TAXE: "Taxe",
};

const EMPTY: RegleForm = {
  code: "", regime: "", intitule: "", intitule_complet: "",
  a_traiter: true, date_debut: "", date_fin: "",
  est_bareme: false, cumuler_plafonds_planchers: false, date_application: "", taxe: "",
  code_assiette: "", type_assiette: "", nb_paie: "", nb_jours: "",
  trentieme: "", rapport: "", mode_calcul: "",
  code_bareme: "", cle_bareme: "", type_bareme: "",
  assiette_negative_acceptee: false, assiette_negative_zero: false, prorata_temporis: false,
  min_salariale: "", max_salariale: "", min_patronale: "", max_patronale: "",
  archive: false,
};

const EMPTY_TRANCHE = (code: string): Tranche => ({ code_tranche: code, plancher: "", plafond: "", taux_salariale: "", taux_patronale: "" });
const EMPTY_RUB = (ligne: string): RubriqueResultat => ({ ligne, rubrique_salariale: "", rubrique_patronale: "" });

/** Format number for display: 1234567.89 → "1 234 567,89" */
const formatNum = (val: string, decimals = 2): string => {
  if (!val) return "";
  const n = parseFloat(val);
  if (isNaN(n)) return val;
  return n.toLocaleString("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

/** Parse formatted string back to raw number string */
const parseNum = (val: string): string => {
  const cleaned = val.replace(/\s/g, "").replace(",", ".");
  if (cleaned === "" || cleaned === "-") return cleaned;
  if (/^-?\d*\.?\d*$/.test(cleaned)) return cleaned;
  return "";
};

/** Controlled numeric input with French formatting on blur */
const NumInput: React.FC<{
  value: string; onChange: (v: string) => void; decimals?: number; className?: string; placeholder?: string;
}> = ({ value, onChange, decimals = 2, className, placeholder }) => {
  const [focused, setFocused] = React.useState(false);
  const display = focused ? value : formatNum(value, decimals);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      placeholder={placeholder}
      className={className}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={e => onChange(parseNum(e.target.value))}
    />
  );
};

interface Props { editId: string | null; onBack: () => void }

const CotisationForm: React.FC<Props> = ({ editId, onBack }) => {
  const isNew = !editId;
  const [form, setForm] = useState<RegleForm>({ ...EMPTY });
  const [tranches, setTranches] = useState<Tranche[]>(TRANCHES.map(EMPTY_TRANCHE));
  const [rubriques, setRubriques] = useState<RubriqueResultat[]>(LIGNES_RUBRIQUES.map(EMPTY_RUB));
  const [allRubriques, setAllRubriques] = useState<Ref[]>([]);
  const [assietteRubriques, setAssietteRubriques] = useState<Ref[]>([]);
  const [calcRubriques, setCalcRubriques] = useState<Ref[]>([]);
  const [loading, setLoading] = useState(!!editId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const setField = (key: string, value: any) => setForm(f => ({ ...f, [key]: value }));

  useEffect(() => {
    const loadRefs = async () => {
      const [rubRes, assRes, calRes] = await Promise.all([
        supabase.from("rubrique_paie" as never).select("code,libelle").order("code" as never),
        supabase.from("rubrique_paie" as never).select("code,libelle").eq("code_type" as never, "ASS" as never).order("code" as never),
        supabase.from("rubrique_paie" as never).select("code,libelle").eq("code_type" as never, "CALC" as never).order("code" as never),
        supabase.from("rubrique_paie" as never).select("code,libelle").eq("code_type" as never, "ASS" as never).order("code" as never),
      ]);
      if (rubRes.data) setAllRubriques(rubRes.data as Ref[]);
      if (assRes.data) setAssietteRubriques(assRes.data as Ref[]);
      if (calRes.data) setCalcRubriques(calRes.data as Ref[]);
    };
    loadRefs();
  }, []);

  useEffect(() => {
    if (!editId) return;
    const load = async () => {
      setLoading(true);
      const [rRes, tRes, rbRes] = await Promise.all([
        supabase.from("regles_cotisation" as never).select("*").eq("id" as never, editId as never).single(),
        supabase.from("regles_cotisation_tranches" as never).select("*").eq("regle_id" as never, editId as never).order("code_tranche" as never),
        supabase.from("regles_cotisation_rubriques" as never).select("*").eq("regle_id" as never, editId as never),
      ]) as any[];
      if (rRes.data) {
        const d = rRes.data;
        setForm({
          code: d.code || "", regime: d.regime || "", intitule: d.intitule || "", intitule_complet: d.intitule_complet || "",
          a_traiter: d.a_traiter, date_debut: d.date_debut || "", date_fin: d.date_fin || "",
          est_bareme: d.est_bareme, cumuler_plafonds_planchers: d.cumuler_plafonds_planchers,
          date_application: d.date_application || "", taxe: d.taxe?.toString() || "",
          code_assiette: d.code_assiette || "", type_assiette: d.type_assiette || "",
          nb_paie: d.nb_paie || "", nb_jours: d.nb_jours || "",
          trentieme: d.trentieme || "", rapport: d.rapport || "", mode_calcul: d.mode_calcul || "",
          code_bareme: d.code_bareme || "", cle_bareme: d.cle_bareme || "", type_bareme: d.type_bareme || "",
          assiette_negative_acceptee: d.assiette_negative_acceptee, assiette_negative_zero: d.assiette_negative_zero,
          prorata_temporis: d.prorata_temporis,
          min_salariale: d.min_salariale?.toString() || "", max_salariale: d.max_salariale?.toString() || "",
          min_patronale: d.min_patronale?.toString() || "", max_patronale: d.max_patronale?.toString() || "",
          archive: d.archive,
        });
      }
      if (tRes.data && tRes.data.length > 0) {
        setTranches(TRANCHES.map(code => {
          const found = (tRes.data as any[]).find((t: any) => t.code_tranche === code);
          return found ? { code_tranche: code, plancher: found.plancher?.toString() || "", plafond: found.plafond?.toString() || "", taux_salariale: found.taux_salariale?.toString() || "", taux_patronale: found.taux_patronale?.toString() || "" } : EMPTY_TRANCHE(code);
        }));
      }
      if (rbRes.data && rbRes.data.length > 0) {
        setRubriques(LIGNES_RUBRIQUES.map(ligne => {
          const found = (rbRes.data as any[]).find((r: any) => r.ligne === ligne);
          return found ? { ligne, rubrique_salariale: found.rubrique_salariale || "", rubrique_patronale: found.rubrique_patronale || "" } : EMPTY_RUB(ligne);
        }));
      }
      setLoading(false);
    };
    load();
  }, [editId]);

  const setTranche = (idx: number, key: string, value: string) =>
    setTranches(prev => prev.map((t, i) => i === idx ? { ...t, [key]: value } : t));

  const setRubrique = (idx: number, key: string, value: string) =>
    setRubriques(prev => prev.map((r, i) => i === idx ? { ...r, [key]: value } : r));

  const handleSave = async () => {
    if (!form.code || !form.intitule) { setError("Code et intitulé sont requis."); return; }
    setSaving(true); setError(null); setSuccess(false);

    const payload: any = {
      regime: form.regime || null, intitule: form.intitule, intitule_complet: form.intitule_complet || null,
      a_traiter: form.a_traiter, date_debut: form.date_debut || null, date_fin: form.date_fin || null,
      est_bareme: form.est_bareme, cumuler_plafonds_planchers: form.cumuler_plafonds_planchers,
      date_application: form.date_application || null, taxe: form.taxe ? parseFloat(form.taxe) : null,
      code_assiette: form.code_assiette || null, type_assiette: form.type_assiette || null,
      nb_paie: form.nb_paie || null, nb_jours: form.nb_jours || null,
      trentieme: form.trentieme || null, rapport: form.rapport || null, mode_calcul: form.mode_calcul || null,
      code_bareme: form.code_bareme || null, cle_bareme: form.cle_bareme || null, type_bareme: form.type_bareme || null,
      assiette_negative_acceptee: form.assiette_negative_acceptee, assiette_negative_zero: form.assiette_negative_zero,
      prorata_temporis: form.prorata_temporis,
      min_salariale: form.min_salariale ? parseFloat(form.min_salariale) : null,
      max_salariale: form.max_salariale ? parseFloat(form.max_salariale) : null,
      min_patronale: form.min_patronale ? parseFloat(form.min_patronale) : null,
      max_patronale: form.max_patronale ? parseFloat(form.max_patronale) : null,
      archive: form.archive,
    };

    let regleId = editId;

    if (isNew) {
      const data = []; const error = null; // Supabase desactive
      if (err) { setError(err.message.includes("duplicate") ? "Ce code existe déjà." : err.message); setSaving(false); return; }
      regleId = (data as any).id;
    } else {
      const { error: err } = await supabase.from("regles_cotisation" as never)
        .update(payload as never).eq("id" as never, editId as never);
      if (err) { setError(err.message); setSaving(false); return; }
    }

    // Upsert tranches
    for (const t of tranches) {
      if (!t.plancher && !t.plafond && !t.taux_salariale && !t.taux_patronale) continue;
      await supabase.from("regles_cotisation_tranches" as never).upsert({
        regle_id: regleId, code_tranche: t.code_tranche,
        plancher: t.plancher ? parseFloat(t.plancher) : null,
        plafond: t.plafond ? parseFloat(t.plafond) : null,
        taux_salariale: t.taux_salariale ? parseFloat(t.taux_salariale) : null,
        taux_patronale: t.taux_patronale ? parseFloat(t.taux_patronale) : null,
      } as never, { onConflict: "regle_id,code_tranche" } as never);
    }

    // Upsert rubriques résultat
    for (const r of rubriques) {
      if (!r.rubrique_salariale && !r.rubrique_patronale) continue;
      await supabase.from("regles_cotisation_rubriques" as never).upsert({
        regle_id: regleId, ligne: r.ligne,
        rubrique_salariale: r.rubrique_salariale || null,
        rubrique_patronale: r.rubrique_patronale || null,
      } as never, { onConflict: "regle_id,ligne" } as never);
    }

    setSaving(false); setSuccess(true);
    setTimeout(() => setSuccess(false), 2000);
    if (isNew) onBack();
  };

  const inputCls = "w-full px-2.5 py-1.5 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all";
  const inputSmCls = "w-full px-2 py-1 rounded-md border text-xs outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all";

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-accent" size={24} /></div>;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-muted transition-colors">
          <ArrowLeft size={18} className="text-muted-foreground" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-foreground">{isNew ? "Nouvelle règle de cotisation" : `Règle ${form.code}`}</h1>
          <p className="text-xs text-muted-foreground">{isNew ? "Configurez une nouvelle règle de cotisation" : "Modifiez la règle de cotisation"}</p>
        </div>
      </div>

      {error && <div className="mb-4 px-4 py-3 rounded-lg text-sm bg-destructive/10 text-destructive border border-destructive/30">{error}</div>}
      {success && <div className="mb-4 px-4 py-3 rounded-lg text-sm bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800">Règle enregistrée avec succès.</div>}

      <Tabs defaultValue="regle" className="w-full">
        <TabsList className="w-full justify-start bg-muted/50 mb-4">
          <TabsTrigger value="regle" className="text-sm">Règle</TabsTrigger>
          <TabsTrigger value="modalites" className="text-sm">Modalités du Calcul</TabsTrigger>
        </TabsList>

        {/* ═══ Onglet Règle ═══ */}
        <TabsContent value="regle" className="mt-0 space-y-5">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Code *</label>
                <input value={form.code} disabled={!isNew} onChange={e => setField("code", e.target.value.toUpperCase())}
                  className={`${inputCls} font-mono ${!isNew ? "opacity-50 cursor-not-allowed" : ""}`} placeholder="CNSS" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Régime</label>
                <input value={form.regime} onChange={e => setField("regime", e.target.value)} className={inputCls} placeholder="Régime général" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Intitulé *</label>
                <input value={form.intitule} onChange={e => setField("intitule", e.target.value)} className={inputCls} placeholder="Cotisation CNSS" />
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Intitulé complet</label>
                <input value={form.intitule_complet} onChange={e => setField("intitule_complet", e.target.value)} className={inputCls} placeholder="Intitulé complet..." />
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.a_traiter} onChange={e => setField("a_traiter", e.target.checked)} className="rounded border-border text-accent" />
                  <span className="text-sm text-foreground">À traiter</span>
                </label>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Début validité</label>
                <input type="date" value={form.date_debut} onChange={e => setField("date_debut", e.target.value)} min="1950-01-01" max="2099-12-31" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Fin</label>
                <input type="date" value={form.date_fin} onChange={e => setField("date_fin", e.target.value)} min="1950-01-01" max="2099-12-31" className={inputCls} />
              </div>
            </div>
          </div>

          {/* Barème + Rubriques côte à côte */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Barème */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.est_bareme} onChange={e => setField("est_bareme", e.target.checked)} className="rounded border-border text-accent" />
                  <span className="text-sm font-semibold text-foreground">Barème</span>
                </label>
              </div>

              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/30">
                      <th className="px-3 py-1.5 text-left text-xs font-semibold text-muted-foreground w-24" />
                      <th className="px-2 py-1.5 text-center text-xs font-semibold text-muted-foreground">Plancher</th>
                      <th className="px-2 py-1.5 text-center text-xs font-semibold text-muted-foreground">Plafond</th>
                      <th className="px-2 py-1.5 text-center text-xs font-semibold text-muted-foreground" colSpan={2}>Taux de Cotisation</th>
                    </tr>
                    <tr className="bg-muted/20">
                      <th />
                      <th />
                      <th />
                      <th className="px-2 py-1 text-center text-xs text-muted-foreground">Salariale</th>
                      <th className="px-2 py-1 text-center text-xs text-muted-foreground">Patronale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tranches.map((t, i) => (
                      <tr key={t.code_tranche} className="border-t border-border">
                        <td className="px-3 py-1 font-medium text-foreground text-xs">Tranche {t.code_tranche} :</td>
                        <td className="px-1 py-1"><NumInput value={t.plancher} onChange={v => setTranche(i, "plancher", v)} decimals={2} className={inputSmCls} /></td>
                        <td className="px-1 py-1"><NumInput value={t.plafond} onChange={v => setTranche(i, "plafond", v)} decimals={2} className={inputSmCls} /></td>
                        <td className="px-1 py-1"><NumInput value={t.taux_salariale} onChange={v => setTranche(i, "taux_salariale", v)} decimals={4} className={inputSmCls} /></td>
                        <td className="px-1 py-1"><NumInput value={t.taux_patronale} onChange={v => setTranche(i, "taux_patronale", v)} decimals={4} className={inputSmCls} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
                <div>
                  <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Taxe</label>
                  <NumInput value={form.taxe} onChange={v => setField("taxe", v)} decimals={4} className={inputCls} />
                </div>
                <div className="flex items-center pt-5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.cumuler_plafonds_planchers} onChange={e => setField("cumuler_plafonds_planchers", e.target.checked)} className="rounded border-border text-accent" />
                    <span className="text-sm text-foreground">Cumuler Plafonds & Planchers</span>
                  </label>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Date application</label>
                  <input type="date" value={form.date_application} onChange={e => setField("date_application", e.target.value)} min="1950-01-01" max="2099-12-31" className={inputCls} />
                </div>
              </div>
            </div>

            {/* Rubriques Résultat */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <h4 className="text-sm font-semibold text-foreground">Rubriques Résultat</h4>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/30">
                      <th className="px-3 py-1.5 text-left text-xs font-semibold text-muted-foreground w-24" />
                      <th className="px-2 py-1.5 text-center text-xs font-semibold text-muted-foreground">Salariale</th>
                      <th className="px-2 py-1.5 text-center text-xs font-semibold text-muted-foreground">Patronale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rubriques.map((r, i) => {
                      const usedForSalariale = new Set(
                        rubriques
                          .flatMap((rb, j) => j === i ? [rb.rubrique_patronale] : [rb.rubrique_salariale, rb.rubrique_patronale])
                          .filter(Boolean)
                      );
                      const usedForPatronale = new Set(
                        rubriques
                          .flatMap((rb, j) => j === i ? [rb.rubrique_salariale] : [rb.rubrique_salariale, rb.rubrique_patronale])
                          .filter(Boolean)
                      );

                      const availableSalariale = calcRubriques.filter(
                        rb => rb.code === r.rubrique_salariale || !usedForSalariale.has(rb.code)
                      );
                      const availablePatronale = calcRubriques.filter(
                        rb => rb.code === r.rubrique_patronale || !usedForPatronale.has(rb.code)
                      );

                      return (
                        <tr key={r.ligne} className="border-t border-border">
                          <td className="px-3 py-1 font-medium text-foreground text-xs">{LIGNES_LABELS[r.ligne]} :</td>
                          <td className="px-1 py-1">
                            <select value={r.rubrique_salariale} onChange={e => setRubrique(i, "rubrique_salariale", e.target.value)} className={inputSmCls}>
                              <option value="">—</option>
                              {availableSalariale.map(rb => <option key={rb.code} value={rb.code}>{rb.code} – {rb.libelle}</option>)}
                            </select>
                          </td>
                          <td className="px-1 py-1">
                            <select value={r.rubrique_patronale} onChange={e => setRubrique(i, "rubrique_patronale", e.target.value)} className={inputSmCls}>
                              <option value="">—</option>
                              {availablePatronale.map(rb => <option key={rb.code} value={rb.code}>{rb.code} – {rb.libelle}</option>)}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ═══ Onglet Modalités du Calcul ═══ */}
        <TabsContent value="modalites" className="mt-0 space-y-5">
          {/* Base Calcul */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Info size={14} className="text-muted-foreground" /> Base Calcul
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Assiette</label>
                <select value={form.code_assiette} onChange={e => setField("code_assiette", e.target.value)} className={inputCls}>
                  <option value="">— Sélectionner —</option>
                  {assietteRubriques.map(r => <option key={r.code} value={r.code}>{r.code} – {r.libelle}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Type</label>
                <select value={form.type_assiette} onChange={e => setField("type_assiette", e.target.value)} className={inputCls}>
                  <option value="">—</option>
                  <option value="PERIODIQUE">Périodique</option>
                  <option value="CUMULEE">Cumulée</option>
                </select>
              </div>
              <div />
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Nb Paie</label>
                <input value={form.nb_paie} onChange={e => setField("nb_paie", e.target.value)} className={inputCls} placeholder="—" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Nb Jours</label>
                <input value={form.nb_jours} onChange={e => setField("nb_jours", e.target.value)} className={inputCls} placeholder="—" />
              </div>
              <div className="flex items-end">
                <span className="text-xs text-muted-foreground italic">Valeurs par défaut</span>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Trentième</label>
                <input value={form.trentieme} onChange={e => setField("trentieme", e.target.value)} className={inputCls} placeholder="—" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Rapport</label>
                <input value={form.rapport} onChange={e => setField("rapport", e.target.value)} className={inputCls} placeholder="—" />
              </div>
            </div>
          </div>

          {/* Mode de calcul & Barème */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Mode de Calcul</label>
                <select value={form.mode_calcul} onChange={e => setField("mode_calcul", e.target.value)} className={inputCls}>
                  <option value="">— Sélectionner —</option>
                  <option value="STANDARD">Standard</option>
                  <option value="TRANCHE">Par tranche</option>
                  <option value="PLAFOND">Plafond</option>
                  <option value="PROGRESSIF">Progressif</option>
                </select>
              </div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Barème Taux Cotisations</h4>
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Code Barème</label>
                <input value={form.code_bareme} onChange={e => setField("code_bareme", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Clé Barème</label>
                <input value={form.cle_bareme} onChange={e => setField("cle_bareme", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Type</label>
                <input value={form.type_bareme} onChange={e => setField("type_bareme", e.target.value)} className={inputCls} />
              </div>
            </div>

            <div className="space-y-5">
              {/* Options */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.assiette_negative_acceptee} onChange={e => setField("assiette_negative_acceptee", e.target.checked)} className="rounded border-border text-accent" />
                  <span className="text-sm text-foreground">Assiette négative acceptée</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.assiette_negative_zero} onChange={e => setField("assiette_negative_zero", e.target.checked)} className="rounded border-border text-accent" />
                  <span className="text-sm text-foreground">Assiette négative ramenée à zéro</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.prorata_temporis} onChange={e => setField("prorata_temporis", e.target.checked)} className="rounded border-border text-accent" />
                  <span className="text-sm text-foreground">Calcul au Prorata Temporis</span>
                </label>
              </div>

              {/* Min/Max Cotisation */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Minimum / Maximum Cotisation</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div />
                  <div className="text-center text-xs font-medium text-muted-foreground">Minimum</div>
                  <div className="text-center text-xs font-medium text-muted-foreground">Maximum</div>

                  <div className="text-sm font-medium text-foreground flex items-center">Salariale</div>
                  <NumInput value={form.min_salariale} onChange={v => setField("min_salariale", v)} decimals={2} className={inputCls} />
                  <NumInput value={form.max_salariale} onChange={v => setField("max_salariale", v)} decimals={2} className={inputCls} />

                  <div className="text-sm font-medium text-foreground flex items-center">Patronale</div>
                  <NumInput value={form.min_patronale} onChange={v => setField("min_patronale", v)} decimals={2} className={inputCls} />
                  <NumInput value={form.max_patronale} onChange={v => setField("max_patronale", v)} decimals={2} className={inputCls} />
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

      </Tabs>

      {/* Actions */}
      <div className="flex items-center gap-3 mt-6">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {saving ? "Enregistrement…" : isNew ? "Créer la règle" : "Enregistrer"}
        </button>
        <button onClick={onBack} className="px-6 py-2.5 rounded-lg text-sm font-medium border border-border text-foreground hover:bg-muted transition-colors">
          Annuler
        </button>
      </div>
    </div>
  );
};

export default CotisationForm;
