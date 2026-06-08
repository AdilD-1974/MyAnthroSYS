/**
 * RubriqueForm – Formulaire complet de création / modification d'une rubrique de paie.
 * Sections affichées en accordéon.
 */
import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Check, Loader2, Plus, Trash2, Info } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
import { useListNavigationContext } from "@/hooks/useListNavigationContext";
import { ChevronLeft, ChevronRight } from "lucide-react";
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface Ref { code: string; libelle: string }
interface Rubrique {
  code: string; libelle: string; libelle_edition: string | null; description: string | null;
  code_famille: string | null; code_flux: string | null; code_type: string | null; code_frequence: string | null;
  frequence_calcul: string; frequence_raz_cumuls: string;
  date_debut: string | null; date_fin: string | null;
  traiter: boolean; simulation: boolean; v_batch: boolean; v_externe: boolean; v_ajout: boolean;
  v_forcage: boolean; v_regularisation: boolean; v_glissant: boolean; v_historique: boolean; pr_cumulee: boolean;
  ordre_calcul: number | null; conditionnee: boolean; code_regle: string | null; archive: boolean;
  zone_fixe_key: string | null;
}
interface Imputation {
  id?: string; code_rubrique: string; numero_imputation: number; code_compte: string; sens: string; intitule_compte: string | null;
}
interface Assiette {
  id?: string; code_rubrique: string; code_assiette: string; sens_assiette: string;
}
interface Alimentation {
  id?: string; code_rubrique: string; code_attribut: string;
  source_type: string; table_source: string | null; donnee_source: string | null;
  rubrique_source: string | null; attribut_source: string | null;
  valeur_constante: string | null; type_constante: string | null;
  nbr_paies_recuperer: number | null;
}

const ATTRIBUTS_RUBRIQUE = ["BASE", "TAUX", "MONT", "DATE", "TEXT"] as const;
const ATTRIBUTS_RUBRIQUE_LABELS: Record<string, string> = {
  BASE: "Nombre", TAUX: "Taux", MONT: "Montant", DATE: "Date", TEXT: "Texte",
};
const SOURCE_TYPES = ["TABLE", "RUBRIQUE", "CONSTANTE"] as const;
const SOURCE_TYPES_LABELS: Record<string, string> = { TABLE: "Table", RUBRIQUE: "Rubrique", CONSTANTE: "Constante" };
const ATTRIBUTS_SOURCE_RUBRIQUE = ["NBR", "TAUX", "MONT"] as const;
const ATTRIBUTS_SOURCE_LABELS: Record<string, string> = { NBR: "Nombre", TAUX: "Taux", MONT: "Montant" };
const TYPES_CONSTANTE_RUBRIQUE = ["PERIODIQUE", "CUMULEE"] as const;
const TABLES_SOURCE: Record<string, string[]> = {
  "collaborateur_salaires_fixes": ["salaire_base", "salaire_horaire", "salaire_journalier", "prime_anciennete", "prime_transport", "prime_logement", "indemnite_fonction", "indemnite_representation", "indemnite_risque", "indemnite_telephone", "indemnite_caisse", "allocation_familiale", ...Array.from({length:20},(_,i)=>`zone_fixe_${String(i+1).padStart(2,"0")}`)],
  "collaborateur_contrats": ["date_debut", "date_fin", "duree_contrat", "code_type_contrat", "code_statut_contrat", "reference_contrat"],
  "collaborateurs": ["date_naissance", "code_genre", "matricule", "nom", "prenom", "cin", "num_cnss", "num_cimr", "num_amo", "num_fiscal"],
  "collaborateur_affectations": ["date_debut_uo", "date_fin_uo", "date_debut_poste", "date_fin_poste", "code_poste", "unite_id"],
  "collaborateur_qualifications": ["date_evolution", "code_emploi", "code_grade", "code_echelle", "echelon_actuel", "code_categorie", "code_filiere"],
  "collaborateur_avantages": ["code_avantage", "valeur_monetaire", "valeur_nature", "date_debut", "date_fin"],
  "collaborateur_immatriculations": ["numero_immatriculation", "code_organisme", "date_debut", "date_fin"],
  "collaborateur_divers": ["taux_ipp", "pension", "rente", "metier_base"],
};

const FREQUENCES_OPTIONS = [
  { code: "MENSUELLE", label: "Mensuelle" },
  { code: "PERIODIQUE", label: "Périodique" },
  { code: "TRIMESTRIELLE", label: "Trimestrielle" },
  { code: "SEMESTRIELLE", label: "Semestrielle" },
  { code: "ANNUELLE", label: "Annuelle" },
];

const EMPTY: Rubrique = {
  code: "", libelle: "", libelle_edition: null, description: null,
  code_famille: null, code_flux: null, code_type: null, code_frequence: null,
  frequence_calcul: "MENSUELLE", frequence_raz_cumuls: "ANNUELLE",
  date_debut: null, date_fin: null,
  traiter: true, simulation: false, v_batch: false, v_externe: false, v_ajout: false,
  v_forcage: false, v_regularisation: false, v_glissant: false, v_historique: false, pr_cumulee: false,
  ordre_calcul: null, conditionnee: false, code_regle: null, archive: false, zone_fixe_key: null,
};

const ZONE_FIXE_OPTIONS = Array.from({ length: 20 }, (_, i) => ({
  value: `zone_fixe_${String(i + 1).padStart(2, "0")}`,
  label: `Zone fixe ${String(i + 1).padStart(2, "0")}`,
}));

const BOOL_FLAGS: { key: keyof Rubrique; label: string; desc: string }[] = [
  { key: "v_batch", label: "Batch", desc: "Traitement par lot" },
  { key: "v_externe", label: "Externe", desc: "Valorisation externe" },
  { key: "v_ajout", label: "Ajout", desc: "Ajout manuel autorisé" },
  { key: "v_forcage", label: "Forçage", desc: "Forçage de valeur autorisé" },
  { key: "v_regularisation", label: "Régularisation", desc: "Régularisable" },
  { key: "v_glissant", label: "Glissant", desc: "Calcul glissant" },
  { key: "v_historique", label: "Historique", desc: "Conservation historique" },
  { key: "pr_cumulee", label: "Pr. Cumulée", desc: "Prime cumulée" },
  { key: "conditionnee", label: "Conditionnée", desc: "Soumise à condition" },
];

interface Props {
  editCode: string | null;
  duplicateCode?: string | null;
  onBack: () => void;
  /** RG-NAV-CTX-01 : Callback pour basculer vers une autre rubrique (prev/next) */
  onSwitchTo?: (code: string) => void;
}

const RubriqueForm: React.FC<Props> = ({ editCode, duplicateCode, onBack, onSwitchTo }) => {
  // RG-NAV-CTX-01 (Adil DAIA) : Navigation Précédent/Suivant entre rubriques filtrées
  const nav = useListNavigationContext("rubriques", editCode || undefined, {
    onNavigate: (code) => onSwitchTo?.(code),
  });
  const sourceCode = editCode || duplicateCode || null;
  const isNew = !editCode;
  const [form, setForm] = useState<Rubrique>({ ...EMPTY });
  const [familles, setFamilles] = useState<Ref[]>([]);
  const [types, setTypes] = useState<Ref[]>([]);
  const [flux, setFlux] = useState<Ref[]>([]);
  const [frequences, setFrequences] = useState<Ref[]>([]);
  const [imputations, setImputations] = useState<Imputation[]>([]);
  const [assiettes, setAssiettes] = useState<Assiette[]>([]);
  const [alimentations, setAlimentations] = useState<Alimentation[]>([]);
  const [assietteRubriques, setAssietteRubriques] = useState<Ref[]>([]);
  const [refComptes, setRefComptes] = useState<{ id: string; code_compte: string; intitule_compte: string | null }[]>([]);
  const [allRubriques, setAllRubriques] = useState<Ref[]>([]);
  const [constantes, setConstantes] = useState<{ code: string; libelle: string; valeur: string }[]>([]);
  const [loading, setLoading] = useState(!!sourceCode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [newImp, setNewImp] = useState({ ref_imputation_id: "", sens: "D" });
  const [newAss, setNewAss] = useState({ code_assiette: "", sens_assiette: "PLUS" });
  const [composantes, setComposantes] = useState<{ code_rubrique: string; libelle: string; sens_assiette: string }[]>([]);

  useEffect(() => {
    const loadRefs = async () => {
      const [fRes, tRes, flRes, frRes, assRes, cptRes, allRubRes, cstRes] = await Promise.all([
        supabase.from("ref_famille_rubrique_paie" as never).select("code,libelle").eq("actif" as never, true as never),
        supabase.from("ref_type_rubrique_paie" as never).select("code,libelle").eq("actif" as never, true as never),
        supabase.from("ref_flux_rubrique_paie" as never).select("code,libelle").eq("actif" as never, true as never),
        supabase.from("ref_frequence_rubrique_paie" as never).select("code,libelle").eq("actif" as never, true as never),
        // RG-RUB-ASS-01 : Seules les rubriques de type ASS peuvent recevoir des composantes – Auteur : Adil DAIA
        supabase.from("rubrique_paie" as never).select("code,libelle").eq("code_type" as never, "ASS" as never).order("code" as never),
        supabase.from("ref_imputation_comptable" as never).select("id,code_compte,intitule_compte").eq("actif" as never, true as never).order("code_compte" as never),
        supabase.from("rubrique_paie" as never).select("code,libelle").order("code" as never),
        supabase.from("ref_constante_paie" as never).select("code,libelle,valeur").eq("actif" as never, true as never).order("code" as never),
      ]);
      if (fRes.data) setFamilles(fRes.data as Ref[]);
      if (tRes.data) setTypes(tRes.data as Ref[]);
      if (flRes.data) setFlux(flRes.data as Ref[]);
      if (frRes.data) setFrequences(frRes.data as Ref[]);
      if (assRes.data) setAssietteRubriques(assRes.data as Ref[]);
      if (cptRes.data) setRefComptes(cptRes.data as any[]);
      if (allRubRes.data) setAllRubriques(allRubRes.data as Ref[]);
      if (cstRes.data) setConstantes(cstRes.data as any[]);
    };
    loadRefs();
  }, []);

  useEffect(() => {
    if (!sourceCode) return;
    const load = async () => {
      setLoading(true);
      const [rRes, iRes, aRes, alRes] = await Promise.all([
        supabase.from("rubrique_paie" as never).select("*").eq("code" as never, sourceCode as never).single(),
        supabase.from("rubrique_paie_imputation" as never).select("*,ref_imputation_comptable(code_compte,intitule_compte)").eq("code_rubrique" as never, sourceCode as never).order("numero_imputation" as never),
        supabase.from("rubrique_paie_assiette" as never).select("*").eq("code_rubrique" as never, sourceCode as never),
        supabase.from("rubrique_paie_alimentation" as never).select("*").eq("code_rubrique" as never, sourceCode as never),
      ]) as any[];
      if (rRes.data) {
        const loaded = rRes.data as Rubrique;
        if (duplicateCode) {
          setForm({ ...loaded, code: "" });
        } else {
          setForm(loaded);
        }
      }
      if (iRes.data) setImputations(iRes.data as Imputation[]);
      if (aRes.data) setAssiettes(aRes.data as Assiette[]);
      if (alRes.data) setAlimentations(alRes.data as Alimentation[]);
      setLoading(false);
    };
    load();
  }, [sourceCode]);

  // Load composantes for ASS-type rubriques
  useEffect(() => {
    const code = editCode || (form.code && form.code_type === "ASS" ? form.code : null);
    if (!code || form.code_type !== "ASS") { setComposantes([]); return; }
    const load = async () => {
      const data = []; const error = null; // Supabase desactive
      if (!data || data.length === 0) { setComposantes([]); return; }
      const codes = data.map((d: any) => d.code_rubrique);
      const data = []; const error = null; // Supabase desactive
      const rubMap = new Map((rubs || []).map((r: any) => [r.code, r.libelle]));
      setComposantes(data.map((d: any) => ({
        code_rubrique: d.code_rubrique,
        libelle: rubMap.get(d.code_rubrique) || d.code_rubrique,
        sens_assiette: d.sens_assiette,
      })));
    };
    load();
  }, [editCode, form.code, form.code_type]);

  const setField = (key: string, value: any) => setForm(f => ({ ...f, [key]: value }));

  const handleSave = async () => {
    if (!form.code || !form.libelle) { setError("Code et libellé sont requis."); return; }
    setSaving(true); setError(null); setSuccess(false);
    const newCode = form.code.toUpperCase();

    if (isNew) {
      const { error: err } = await supabase.from("rubrique_paie" as never)
        .insert({ ...form, code: newCode } as never);
      if (err) { setError(err.message.includes("duplicate") ? "Ce code existe déjà." : err.message); setSaving(false); return; }

      // En mode duplication, cloner les données liées (imputations, assiettes, alimentations)
      if (duplicateCode) {
        // Cloner les imputations
        for (const imp of imputations) {
          await supabase.from("rubrique_paie_imputation" as never).insert({
            code_rubrique: newCode,
            numero_imputation: imp.numero_imputation,
            ref_imputation_id: (imp as any).ref_imputation_id,
            sens: imp.sens,
          } as never);
        }
        // Cloner les assiettes
        for (const ass of assiettes) {
          await supabase.from("rubrique_paie_assiette" as never).insert({
            code_rubrique: newCode,
            code_assiette: ass.code_assiette,
            sens_assiette: ass.sens_assiette,
          } as never);
        }
        // Cloner les alimentations
        for (const al of alimentations) {
          const { id, ...rest } = al as any;
          await supabase.from("rubrique_paie_alimentation" as never).insert({
            ...rest,
            code_rubrique: newCode,
          } as never);
        }
      }
    } else {
      const { code, ...rest } = form;
      const { error: err } = await supabase.from("rubrique_paie" as never)
        .update(rest as never).eq("code" as never, editCode as never);
      if (err) { setError(err.message); setSaving(false); return; }
    }


    setSaving(false);
    setSuccess(true);
    setTimeout(() => setSuccess(false), 2000);
    if (isNew) onBack();
  };

  const addImputation = async () => {
    if (!newImp.ref_imputation_id) return;
    const codeRub = editCode || form.code.toUpperCase();
    if (!codeRub) { setError("Enregistrez d'abord la rubrique."); return; }
    const nextNum = imputations.length > 0 ? Math.max(...imputations.map(i => i.numero_imputation)) + 1 : 1;
    const { error: err } = await supabase.from("rubrique_paie_imputation" as never).insert({
      code_rubrique: codeRub, numero_imputation: nextNum, ref_imputation_id: newImp.ref_imputation_id, sens: newImp.sens,
    } as never);
    if (err) { setError(err.message); return; }
    const data = []; const error = null; // Supabase desactive
    setImputations((data || []) as any[]);
    setNewImp({ ref_imputation_id: "", sens: "D" });
  };

  const deleteImputation = async (id: string) => {
    await supabase.from("rubrique_paie_imputation" as never).delete().eq("id" as never, id as never);
    setImputations(prev => prev.filter(i => i.id !== id));
  };

  const addAssiette = async () => {
    if (!newAss.code_assiette) return;
    const codeRub = editCode || form.code.toUpperCase();
    if (!codeRub) { setError("Enregistrez d'abord la rubrique."); return; }
    const { error: err } = await supabase.from("rubrique_paie_assiette" as never).insert({
      code_rubrique: codeRub, code_assiette: newAss.code_assiette, sens_assiette: newAss.sens_assiette,
    } as never);
    if (err) { setError(err.message.includes("duplicate") ? "Cette assiette est déjà associée." : err.message); return; }
    const data = []; const error = null; // Supabase desactive
    setAssiettes((data || []) as Assiette[]);
    setNewAss({ code_assiette: "", sens_assiette: "PLUS" });
  };

  const deleteAssiette = async (id: string) => {
    await supabase.from("rubrique_paie_assiette" as never).delete().eq("id" as never, id as never);
    setAssiettes(prev => prev.filter(a => a.id !== id));
  };

  const assietteLabel = (code: string) => assietteRubriques.find(r => r.code === code)?.libelle || code;

  const getAlimentation = (attr: string) => alimentations.find(a => a.code_attribut === attr);

  const saveAlimentation = async (attr: string, field: string, value: any) => {
    const codeRub = editCode || form.code.toUpperCase();
    if (!codeRub) { setError("Enregistrez d'abord la rubrique."); return; }
    const existing = getAlimentation(attr);
    if (existing?.id) {
      await supabase.from("rubrique_paie_alimentation" as never).update({ [field]: value } as never).eq("id" as never, existing.id as never);
      setAlimentations(prev => prev.map(a => a.code_attribut === attr ? { ...a, [field]: value } : a));
    } else {
      const newRow: any = { code_rubrique: codeRub, code_attribut: attr, [field]: value };
      const data = []; const error = null; // Supabase desactive
      if (err) { setError(err.message); return; }
      if (data) setAlimentations(prev => [...prev, data as Alimentation]);
    }
  };

  const SelectField: React.FC<{ label: string; value: string | null; refs: Ref[]; field: string }> = ({ label, value, refs, field }) => (
    <div>
      <label className="block text-xs font-medium mb-1.5 text-muted-foreground">{label}</label>
      <select value={value || ""} onChange={e => {
          const val = e.target.value || null;
          setField(field, val);
          if (field === "code_type" && val === "ASS") {
            setField("ordre_calcul", 0);
            setField("code_regle", null);
          }
        }}
        className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all">
        <option value="">— Sélectionner —</option>
        {refs.map(r => <option key={r.code} value={r.code}>{r.libelle}</option>)}
      </select>
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-accent" size={24} />
      </div>
    );
  }

  const defaultOpen = ["general", "classification", "alimentation", "calcul"];
  if (!isNew) defaultOpen.push("assiettes", "imputations", "composantes");

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-lg hover:bg-muted transition-colors">
            <ArrowLeft size={18} className="text-muted-foreground" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              {duplicateCode ? `Duplication de ${duplicateCode}` : isNew ? "Nouvelle rubrique de paie" : `Rubrique ${editCode}`}
            </h1>
            <p className="text-xs text-muted-foreground">
              {duplicateCode ? "Saisissez un nouveau code pour la rubrique dupliquée" : isNew ? "Remplissez les informations pour créer une nouvelle rubrique" : "Modifiez les informations de la rubrique"}
            </p>
          </div>
        </div>

        {/* Navigation Précédent/Suivant — RG-NAV-CTX-01 */}
        {nav.hasContext && onSwitchTo && (
          <div className="flex items-center gap-1 px-3 py-1.5 rounded-lg border bg-muted/30">
            <button
              onClick={nav.goPrev}
              disabled={!nav.prevId}
              title="Rubrique précédente (←)"
              className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-accent">
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs font-mono px-2 select-none text-muted-foreground">
              {nav.current} / {nav.total}
            </span>
            <button
              onClick={nav.goNext}
              disabled={!nav.nextId}
              title="Rubrique suivante (→)"
              className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-accent">
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Erreur / Succès */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm bg-destructive/10 text-destructive border border-destructive/30">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800">
          Rubrique enregistrée avec succès.
        </div>
      )}

      {/* Formulaire en accordéon */}
      <Accordion type="multiple" defaultValue={defaultOpen} className="space-y-3">
        {/* Informations générales */}
        <AccordionItem value="general" className="rounded-xl border border-border bg-card px-5">
          <AccordionTrigger className="text-sm font-semibold text-foreground hover:no-underline">
            Informations générales
          </AccordionTrigger>
          <AccordionContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Code *</label>
                <input
                  value={form.code} disabled={!isNew}
                  onChange={e => setField("code", e.target.value.toUpperCase())}
                  className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed font-mono"
                  placeholder="R100"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Libellé *</label>
                <input
                  value={form.libelle} onChange={e => setField("libelle", e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                  placeholder="Salaire de base"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Libellé édition</label>
                <input
                  value={form.libelle_edition || ""} onChange={e => setField("libelle_edition", e.target.value || null)}
                  className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                  placeholder="SAL.BASE"
                />
              </div>

              {/* Traiter & Simulation */}
              <div className="flex items-center gap-6 sm:col-span-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.traiter} onChange={e => setField("traiter", e.target.checked)}
                    className="rounded border-border text-accent focus:ring-accent/30" />
                  <span className="text-sm font-medium text-foreground">À traiter</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.simulation} onChange={e => setField("simulation", e.target.checked)}
                    className="rounded border-border text-accent focus:ring-accent/30" />
                  <span className="text-sm font-medium text-foreground">Simulation</span>
                </label>
              </div>

              {/* Date début & fin */}
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Date début</label>
                <input type="date"
                  value={form.date_debut || ""} onChange={e => setField("date_debut", e.target.value || null)}
                  min="1950-01-01" max="2099-12-31"
                  className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Date fin</label>
                <input type="date"
                  value={form.date_fin || ""} onChange={e => setField("date_fin", e.target.value || null)}
                  min="1950-01-01" max="2099-12-31"
                  className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-4">
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Description</label>
                <textarea
                  value={form.description || ""} onChange={e => setField("description", e.target.value || null)}
                  rows={2}
                  className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all resize-none"
                  placeholder="Description de la rubrique..."
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Classification */}
        <AccordionItem value="classification" className="rounded-xl border border-border bg-card px-5">
          <AccordionTrigger className="text-sm font-semibold text-foreground hover:no-underline">
            Classification & Fréquences
          </AccordionTrigger>
          <AccordionContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
              <SelectField label="Famille" value={form.code_famille} refs={familles} field="code_famille" />
              <SelectField label="Type" value={form.code_type} refs={types} field="code_type" />
              <SelectField label="Flux" value={form.code_flux} refs={flux} field="code_flux" />
              <SelectField label="Fréquence" value={form.code_frequence} refs={frequences} field="code_frequence" />
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Zone fixe associée</label>
                <select
                  value={form.zone_fixe_key || ""}
                  onChange={e => setField("zone_fixe_key", e.target.value || null)}
                  className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                >
                  <option value="">— Aucune —</option>
                  {ZONE_FIXE_OPTIONS.map(z => (
                    <option key={z.value} value={z.value}>{z.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Fréquences de calcul et RAZ */}
            <div className="border-t border-border pt-4">
              <p className="text-xs font-semibold text-foreground mb-3">Fréquences de calcul et de remise à zéro</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Fréquence de calcul</label>
                  <select value={form.frequence_calcul} onChange={e => setField("frequence_calcul", e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all">
                    {FREQUENCES_OPTIONS.map(f => <option key={f.code} value={f.code}>{f.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Fréquence de RAZ des cumuls</label>
                  <select value={form.frequence_raz_cumuls} onChange={e => setField("frequence_raz_cumuls", e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all">
                    {FREQUENCES_OPTIONS.map(f => <option key={f.code} value={f.code}>{f.label}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Note: L'association périodique au calendrier se gère dans le référentiel des fréquences (Paramétrage Paie) */}
            {(form.frequence_calcul === "PERIODIQUE" || form.frequence_raz_cumuls === "PERIODIQUE") && (
              <p className="text-xs text-muted-foreground mt-3 italic border-t border-border pt-3">
                ℹ️ Les périodes associées à la fréquence "Périodique" sont configurées dans le référentiel des fréquences (Paramétrage Paie &gt; Fréquences).
              </p>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* Alimentation des rubriques — masqué pour type Assiette */}
        {form.code_type !== "ASS" && (
        <AccordionItem value="alimentation" className="rounded-xl border border-border bg-card px-5">
          <AccordionTrigger className="text-sm font-semibold text-foreground hover:no-underline">
            Alimentation des rubriques
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-xs text-muted-foreground mb-4">
              Définissez pour chaque attribut la source de valorisation : une table, une rubrique ou une constante.
            </p>
            <div className="space-y-3">
              {ATTRIBUTS_RUBRIQUE.map(attr => {
                const al = getAlimentation(attr);
                const srcType = al?.source_type || "TABLE";
                const selectedTable = al?.table_source || "";
                const fieldsForTable = selectedTable ? (TABLES_SOURCE[selectedTable] || []) : [];
                return (
                  <div key={attr} className="p-3 rounded-lg border border-border bg-muted/30 space-y-3">
                    <div className="flex items-center gap-4">
                      <span className="text-sm font-mono font-semibold text-accent w-20">{ATTRIBUTS_RUBRIQUE_LABELS[attr]}</span>
                      <div className="flex gap-2">
                        {SOURCE_TYPES.map(st => (
                          <button key={st} type="button"
                            onClick={() => saveAlimentation(attr, "source_type", st)}
                            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${srcType === st ? "bg-accent text-white" : "bg-background border border-border text-muted-foreground hover:bg-muted"}`}>
                            {SOURCE_TYPES_LABELS[st]}
                          </button>
                        ))}
                      </div>
                    </div>

                    {srcType === "TABLE" && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium mb-1 text-muted-foreground">Table</label>
                          <select value={selectedTable}
                            onChange={e => { saveAlimentation(attr, "table_source", e.target.value || null); saveAlimentation(attr, "donnee_source", null); }}
                            className="w-full px-2 py-2 rounded-lg border text-sm bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all">
                            <option value="">— Sélectionner —</option>
                            {Object.keys(TABLES_SOURCE).map(t => <option key={t} value={t}>{t.replace("collaborateur_", "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1 text-muted-foreground">Champ</label>
                          <select value={al?.donnee_source || ""}
                            onChange={e => saveAlimentation(attr, "donnee_source", e.target.value || null)}
                            disabled={!selectedTable}
                            className="w-full px-2 py-2 rounded-lg border text-sm bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all disabled:opacity-50">
                            <option value="">— Sélectionner —</option>
                            {fieldsForTable.map(f => <option key={f} value={f}>{f.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</option>)}
                          </select>
                        </div>
                      </div>
                    )}

                    {srcType === "RUBRIQUE" && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-xs font-medium mb-1 text-muted-foreground">Rubrique</label>
                          <select value={al?.rubrique_source || ""}
                            onChange={e => saveAlimentation(attr, "rubrique_source", e.target.value || null)}
                            className="w-full px-2 py-2 rounded-lg border text-sm bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all">
                            <option value="">— Sélectionner —</option>
                            {allRubriques.map(r => <option key={r.code} value={r.code}>{r.code} – {r.libelle}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1 text-muted-foreground">Attribut</label>
                          <select value={al?.attribut_source || ""}
                            onChange={e => saveAlimentation(attr, "attribut_source", e.target.value || null)}
                            className="w-full px-2 py-2 rounded-lg border text-sm bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all">
                            <option value="">— Sélectionner —</option>
                            {ATTRIBUTS_SOURCE_RUBRIQUE.map(a => <option key={a} value={a}>{ATTRIBUTS_SOURCE_LABELS[a]}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1 text-muted-foreground">Type</label>
                          <select value={al?.type_constante || ""}
                            onChange={e => saveAlimentation(attr, "type_constante", e.target.value || null)}
                            className="w-full px-2 py-2 rounded-lg border text-sm bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all">
                            <option value="">— Sélectionner —</option>
                            <option value="PERIODIQUE">Périodique</option>
                            <option value="CUMULEE">Cumulée</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1 text-muted-foreground">Nbr paies à récupérer</label>
                          <input type="number" min="0"
                            value={al?.nbr_paies_recuperer ?? ""}
                            onChange={e => saveAlimentation(attr, "nbr_paies_recuperer", e.target.value ? parseInt(e.target.value) : null)}
                            placeholder="Période en cours"
                            className="w-full px-2 py-2 rounded-lg border text-sm bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                          />
                          <p className="text-[10px] text-muted-foreground mt-0.5">Vide = période en cours</p>
                        </div>
                      </div>
                    )}

                    {srcType === "CONSTANTE" && (
                      <div className="grid grid-cols-1 gap-3">
                        <div>
                          <label className="block text-xs font-medium mb-1 text-muted-foreground">Constante</label>
                          <select value={al?.valeur_constante || ""}
                            onChange={e => saveAlimentation(attr, "valeur_constante", e.target.value || null)}
                            className="w-full px-2 py-2 rounded-lg border text-sm bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all">
                            <option value="">— Sélectionner une constante —</option>
                            {constantes.map(c => (
                              <option key={c.code} value={c.code}>{c.code} – {c.libelle} ({c.valeur})</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </AccordionContent>
        </AccordionItem>
        )}

        {/* Paramètres de calcul */}
        <AccordionItem value="calcul" className="rounded-xl border border-border bg-card px-5">
          <AccordionTrigger className="text-sm font-semibold text-foreground hover:no-underline">
            Paramètres de calcul
          </AccordionTrigger>
          <AccordionContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
              <div className="w-28">
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Ordre</label>
                <input type="number"
                  value={form.code_type === "ASS" ? 0 : (form.ordre_calcul ?? "")}
                  disabled={form.code_type === "ASS"}
                  onChange={e => setField("ordre_calcul", e.target.value ? parseInt(e.target.value) : null)}
                  className={`w-full px-3 py-2.5 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all ${form.code_type === "ASS" ? "opacity-50 cursor-not-allowed" : ""}`}
                />
                {form.code_type === "ASS" && (
                  <p className="text-[10px] text-muted-foreground mt-1">Ordre fixé à 0 — calcul déclenché par la rubrique appelante</p>
                )}
              </div>
              {form.code_type !== "ASS" && (
                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="block text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wider">Règle de calcul</label>
                  <Tabs defaultValue="normale" className="w-full">
                    <TabsList className="w-full justify-start bg-muted/50 mb-3">
                      <TabsTrigger value="normale" className="text-xs">Règle normale</TabsTrigger>
                      <TabsTrigger value="cotisation" className="text-xs">Règle cotisation</TabsTrigger>
                      <TabsTrigger value="bareme" className="text-xs">Recherche barème</TabsTrigger>
                    </TabsList>

                    {/* Règle normale */}
                    <TabsContent value="normale" className="mt-0">
                      <div className="rounded-lg border border-border bg-background p-4 space-y-3">
                        <div className="flex items-start gap-2 mb-2">
                          <Info size={14} className="text-muted-foreground mt-0.5 shrink-0" />
                          <p className="text-xs text-muted-foreground">Formule de calcul standard basée sur des rubriques existantes.</p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Base (rubrique)</label>
                            <select
                              value={form.code_regle || ""}
                              onChange={e => setField("code_regle", e.target.value || null)}
                              className="w-full px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                            >
                              <option value="">— Aucune —</option>
                              {allRubriques.map(r => (
                                <option key={r.code} value={r.code}>{r.code} – {r.libelle}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Taux (%)</label>
                            <input type="number" step="0.01" placeholder="100"
                              className="w-full px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Nombre (rubrique)</label>
                            <select
                              className="w-full px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                            >
                              <option value="">— Aucune —</option>
                              {allRubriques.map(r => (
                                <option key={r.code} value={r.code}>{r.code} – {r.libelle}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Montant fixe</label>
                            <input type="number" step="0.01" placeholder="0.00"
                              className="w-full px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                            />
                          </div>
                        </div>
                      </div>
                    </TabsContent>

                    {/* Règle cotisation */}
                    <TabsContent value="cotisation" className="mt-0">
                      <div className="rounded-lg border border-border bg-background p-4 space-y-3">
                        <div className="flex items-start gap-2 mb-2">
                          <Info size={14} className="text-muted-foreground mt-0.5 shrink-0" />
                          <p className="text-xs text-muted-foreground">Calcul de cotisation : Base × Taux avec plafond et plancher optionnels.</p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Base cotisation (rubrique)</label>
                            <select
                              className="w-full px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                            >
                              <option value="">— Sélectionner —</option>
                              {allRubriques.map(r => (
                                <option key={r.code} value={r.code}>{r.code} – {r.libelle}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Taux salarial (%)</label>
                            <input type="number" step="0.01" placeholder="0.00"
                              className="w-full px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Taux patronal (%)</label>
                            <input type="number" step="0.01" placeholder="0.00"
                              className="w-full px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Plafond</label>
                            <input type="number" step="0.01" placeholder="Illimité"
                              className="w-full px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Plancher</label>
                            <input type="number" step="0.01" placeholder="0.00"
                              className="w-full px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Part (rubrique résultat)</label>
                            <select
                              className="w-full px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                            >
                              <option value="">— Aucune —</option>
                              {allRubriques.map(r => (
                                <option key={r.code} value={r.code}>{r.code} – {r.libelle}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    </TabsContent>

                    {/* Recherche barème */}
                    <TabsContent value="bareme" className="mt-0">
                      <div className="rounded-lg border border-border bg-background p-4 space-y-3">
                        <div className="flex items-start gap-2 mb-2">
                          <Info size={14} className="text-muted-foreground mt-0.5 shrink-0" />
                          <p className="text-xs text-muted-foreground">Recherche dans un barème pour déterminer le montant selon une valeur de référence (ancienneté, salaire…).</p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Barème (rubrique)</label>
                            <select
                              className="w-full px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                            >
                              <option value="">— Sélectionner —</option>
                              {allRubriques.filter(r => r.code !== (editCode || form.code)).map(r => (
                                <option key={r.code} value={r.code}>{r.code} – {r.libelle}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Valeur de recherche (rubrique)</label>
                            <select
                              className="w-full px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                            >
                              <option value="">— Sélectionner —</option>
                              {allRubriques.map(r => (
                                <option key={r.code} value={r.code}>{r.code} – {r.libelle}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Colonne résultat</label>
                            <input type="text" placeholder="Ex : montant, taux…"
                              className="w-full px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Mode de recherche</label>
                            <select
                              className="w-full px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                            >
                              <option value="TRANCHE">Par tranche</option>
                              <option value="EXACT">Exact</option>
                              <option value="PLAFOND">Plafond</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>
              )}
            </div>

            {/* Flags booléens */}
            <h3 className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">Indicateurs de traitement</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {BOOL_FLAGS.map(({ key, label, desc }) => (
                <label key={key}
                  className="flex items-start gap-2.5 p-3 rounded-lg border border-border hover:border-accent/30 cursor-pointer transition-colors bg-background"
                  title={desc}
                >
                  <input type="checkbox"
                    checked={!!form[key]}
                    onChange={e => setField(key, e.target.checked)}
                    className="mt-0.5 rounded border-border text-accent focus:ring-accent/30"
                  />
                  <div>
                    <span className="text-sm font-medium text-foreground">{label}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Composantes de l'assiette (uniquement pour type ASS en mode édition) */}
        {!isNew && form.code_type === "ASS" && (
          <AccordionItem value="composantes" className="rounded-xl border border-accent/30 bg-accent/5 px-5">
            <AccordionTrigger className="text-sm font-semibold text-foreground hover:no-underline">
              📋 Rubriques composantes de cette assiette ({composantes.length})
            </AccordionTrigger>
            <AccordionContent>
              <p className="text-xs text-muted-foreground mb-4">
                Liste des rubriques dont la valeur alimente le calcul de cette assiette.
              </p>
              {composantes.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground italic py-4">
                  <Info size={14} />
                  Aucune rubrique ne référence cette assiette pour le moment.
                </div>
              ) : (
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/30">
                        <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground">Code rubrique</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground">Libellé</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground">Sens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {composantes.map(c => (
                        <tr key={c.code_rubrique} className="border-t border-border">
                          <td className="px-4 py-2.5 font-mono text-foreground">{c.code_rubrique}</td>
                          <td className="px-4 py-2.5 text-foreground">{c.libelle}</td>
                          <td className="px-4 py-2.5">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${c.sens_assiette === "PLUS" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
                              {c.sens_assiette === "PLUS" ? "+ En plus" : "− En moins"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Assiettes */}
        {/* RG-RUB-ASS-02 : À l'exception des assiettes (ASS), toutes les autres rubriques peuvent être injectées dans les assiettes – Auteur : Adil DAIA */}
        {!isNew && form.code_type !== "ASS" && (
          <AccordionItem value="assiettes" className="rounded-xl border border-border bg-card px-5">
            <AccordionTrigger className="text-sm font-semibold text-foreground hover:no-underline">
              Assiettes
            </AccordionTrigger>
            <AccordionContent>
              <p className="text-xs text-muted-foreground mb-4">
                La valeur de cette rubrique s'ajoute (en plus ou en moins) dans les rubriques de type Assiette ci-dessous.
              </p>
              {assiettes.length > 0 && (
                <div className="rounded-lg border border-border overflow-hidden mb-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/30">
                        <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground">Code assiette</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground">Libellé</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground">Sens</th>
                        <th className="px-4 py-2 w-12" />
                      </tr>
                    </thead>
                    <tbody>
                      {assiettes.map(a => (
                        <tr key={a.id || a.code_assiette} className="border-t border-border">
                          <td className="px-4 py-2.5 font-mono text-foreground">{a.code_assiette}</td>
                          <td className="px-4 py-2.5 text-foreground">{assietteLabel(a.code_assiette)}</td>
                          <td className="px-4 py-2.5">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${a.sens_assiette === "PLUS" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
                              {a.sens_assiette === "PLUS" ? "+ En plus" : "− En moins"}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            {a.id && (
                              <button onClick={() => deleteAssiette(a.id!)} className="p-1 rounded hover:bg-muted">
                                <Trash2 size={12} className="text-destructive" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex items-end gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Assiette</label>
                  <select value={newAss.code_assiette} onChange={e => setNewAss(p => ({ ...p, code_assiette: e.target.value }))}
                    className="px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all w-56">
                    <option value="">— Sélectionner —</option>
                    {assietteRubriques.filter(r => r.code !== (editCode || form.code)).map(r => (
                      <option key={r.code} value={r.code}>{r.code} – {r.libelle}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Sens</label>
                  <select value={newAss.sens_assiette} onChange={e => setNewAss(p => ({ ...p, sens_assiette: e.target.value }))}
                    className="px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all">
                    <option value="PLUS">+ En plus</option>
                    <option value="MOINS">− En moins</option>
                  </select>
                </div>
                <button onClick={addAssiette}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
                  <Plus size={13} /> Ajouter
                </button>
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Imputations comptables */}
        {!isNew && (
          <AccordionItem value="imputations" className="rounded-xl border border-border bg-card px-5">
            <AccordionTrigger className="text-sm font-semibold text-foreground hover:no-underline">
              Imputations comptables
            </AccordionTrigger>
            <AccordionContent>
              {imputations.length > 0 && (
                <div className="rounded-lg border border-border overflow-hidden mb-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/30">
                        <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground">N°</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground">Compte</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground">Intitulé</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground">Sens</th>
                        <th className="px-4 py-2 w-12" />
                      </tr>
                    </thead>
                    <tbody>
                      {imputations.map((imp: any) => (
                        <tr key={imp.id || imp.numero_imputation} className="border-t border-border">
                          <td className="px-4 py-2.5 text-foreground">{imp.numero_imputation}</td>
                          <td className="px-4 py-2.5 font-mono text-foreground">{imp.ref_imputation_comptable?.code_compte || imp.code_compte}</td>
                          <td className="px-4 py-2.5 text-foreground">{imp.ref_imputation_comptable?.intitule_compte || imp.intitule_compte || "—"}</td>
                          <td className="px-4 py-2.5">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${imp.sens === "D" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" : "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"}`}>
                              {imp.sens === "D" ? "Débit" : "Crédit"}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            {imp.id && (
                              <button onClick={() => deleteImputation(imp.id!)} className="p-1 rounded hover:bg-muted">
                                <Trash2 size={12} className="text-destructive" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {/* Ajout imputation */}
              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Compte</label>
                  <select
                    value={newImp.ref_imputation_id}
                    onChange={e => setNewImp(p => ({ ...p, ref_imputation_id: e.target.value }))}
                    className="px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all w-72"
                  >
                    <option value="">— Sélectionner un compte —</option>
                    {refComptes.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.code_compte} – {c.intitule_compte || ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Sens</label>
                  <select value={newImp.sens} onChange={e => setNewImp(p => ({ ...p, sens: e.target.value }))}
                    className="px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all">
                    <option value="D">Débit</option>
                    <option value="C">Crédit</option>
                  </select>
                </div>
                <button onClick={addImputation}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
                  <Plus size={13} /> Ajouter
                </button>
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Archive */}
        <AccordionItem value="archive" className="rounded-xl border border-border bg-card px-5">
          <AccordionTrigger className="text-sm font-semibold text-foreground hover:no-underline">
            Archivage
          </AccordionTrigger>
          <AccordionContent>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={form.archive} onChange={e => setField("archive", e.target.checked)}
                className="rounded border-border text-accent focus:ring-accent/30" />
              <div>
                <span className="text-sm font-medium text-foreground">Archiver cette rubrique</span>
                <p className="text-xs text-muted-foreground">La rubrique ne sera plus visible dans les listes actives</p>
              </div>
            </label>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Actions */}
      <div className="flex items-center gap-3 mt-6">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {saving ? "Enregistrement…" : isNew ? "Créer la rubrique" : "Enregistrer les modifications"}
        </button>
        <button onClick={onBack}
          className="px-6 py-2.5 rounded-lg text-sm font-medium border border-border text-foreground hover:bg-muted transition-colors">
          Annuler
        </button>
      </div>
    </div>
  );
};

export default RubriqueForm;
