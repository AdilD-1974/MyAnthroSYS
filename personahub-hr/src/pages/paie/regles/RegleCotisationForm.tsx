/**
 * RegleCotisationForm – Création / édition d'une règle de cotisation.
 * Auteur : Adil DAIA
 *
 * RG-COTIS-COMPO-01 : Une règle de cotisation est composée de N tranches
 * (composantes). Exemple CNSS = PF + LCT + CT, chacune avec son taux
 * salarial/patronal et son plafond.
 *
 * Chaque composante peut être liée à 2 rubriques de paie distinctes
 * (part salariale et part patronale).
 */
import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft, Save, Loader2, AlertTriangle, Plus, Trash2,
  ChevronDown, ChevronRight, Layers, Info,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import FormattedInput from "@/components/paie/FormattedInput";

interface Regime { code: string; libelle: string; organisme: string | null; }
interface Rubrique { code: string; libelle: string; code_famille: string | null; code_type: string | null; }

interface Composante {
  id?: string;
  _id: string;
  code: string;
  libelle: string;
  ordre: number;
  code_rubrique_assiette: string | null;
  taux_salarial: number | null;
  taux_patronal: number | null;
  plafond_mensuel: number | null;
  code_rubrique_part_salariale: string | null;
  code_rubrique_part_patronale: string | null;
  actif: boolean;
}

interface Props {
  editId: string | null;
  regimes: Regime[];
  onBack: () => void;
}

const EMPTY_HEADER = {
  code: "", libelle: "", description: "", code_regime: "",
  date_debut_validite: "", date_fin_validite: "",
  decision_reference: "", actif: true,
  // Modalités de calcul (RG-COTIS-MOD-01)
  mode_calcul: "PERIODIQUE" as "PERIODIQUE" | "CUMUL" | "GLISSANT",
  code_rubrique_nb_paie: null as string | null,
  code_rubrique_nb_jours: null as string | null,
  code_rubrique_trentieme: null as string | null,
  code_rubrique_rapport: null as string | null,
  valeur_defaut_nb_paie: null as number | null,
  valeur_defaut_nb_jours: null as number | null,
  valeur_defaut_trentieme: null as number | null,
  valeur_defaut_rapport: null as number | null,
  assiette_negative_acceptee: false,
  assiette_negative_ramenee_zero: false,
  prorata_temporis: false,
  minimum_salarial: null as number | null,
  minimum_patronal: null as number | null,
  maximum_salarial: null as number | null,
  maximum_patronal: null as number | null,
  code_bareme_taux: null as string | null,
};

const uid = () => Math.random().toString(36).slice(2);

const RegleCotisationForm: React.FC<Props> = ({ editId, regimes, onBack }) => {
  const [form, setForm] = useState<typeof EMPTY_HEADER>(EMPTY_HEADER);
  const [composantes, setComposantes] = useState<Composante[]>([]);
  const [rubriques, setRubriques] = useState<Rubrique[]>([]);
  const [rubriquesAll, setRubriquesAll] = useState<Rubrique[]>([]);
  const [baremes, setBaremes] = useState<Array<{ code: string; libelle: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!editId);
  const [error, setError] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState({
    entete: true, composantes: true, validite: true,
  });
  const toggleSection = (k: keyof typeof openSections) =>
    setOpenSections(s => ({ ...s, [k]: !s[k] }));

  useEffect(() => {
    const init = async () => {
      // RG-COTIS-RUB-01 (Adil DAIA) : Sources de rubriques distinctes selon usage
      //   - Famille COT_SAL = Cotisations salariales → "Rubrique part Sal."
      //   - Famille COT_PAT = Cotisations patronales → "Rubrique part Pat."
      //   - Type ASS = Assiettes de calcul → "Assiette (rubrique)"
      //   - Toutes rubriques actives → bases de calcul (Nb paie, Nb jours, etc.)
      const [{ data: rubsCotis }, { data: rubsAssiettes }, { data: rubsAll }, { data: bars }] = await Promise.all([
        supabase.from("rubrique_paie" as never)
          .select("code,libelle,code_famille,code_type")
          .eq("archive" as never, false as never)
          .in("code_famille" as never, ["COT_SAL", "COT_PAT"] as never)
          .order("code" as never),
        supabase.from("rubrique_paie" as never)
          .select("code,libelle,code_famille,code_type")
          .eq("archive" as never, false as never)
          .eq("code_type" as never, "ASS" as never)
          .order("code" as never),
        supabase.from("rubrique_paie" as never)
          .select("code,libelle,code_famille,code_type")
          .eq("archive" as never, false as never)
          .order("code" as never),
        supabase.from("bareme" as never)
          .select("code,libelle")
          .eq("archive" as never, false as never)
          .order("code" as never),
      ]);
      // Fusion (en évitant les doublons si une rubrique est à la fois ASS et COT_*)
      const merged: Rubrique[] = [...((rubsCotis || []) as Rubrique[])];
      const seen = new Set(merged.map(r => r.code));
      ((rubsAssiettes || []) as Rubrique[]).forEach(r => {
        if (!seen.has(r.code)) merged.push(r);
      });
      setRubriques(merged);
      setRubriquesAll((rubsAll || []) as Rubrique[]);
      setBaremes((bars || []) as Array<{ code: string; libelle: string }>);

      if (editId) {
        const [{ data: regle }, { data: compos }] = await Promise.all([
          supabase.from("regle_calcul_cotisation" as never)
            .select("*").eq("id" as never, editId as never).single(),
          supabase.from("regle_calcul_cotisation_composante" as never)
            .select("*").eq("id_regle" as never, editId as never).order("ordre" as never),
        ]);
        if (regle) {
          const d = regle as any;
          setForm({
            code: d.code || "", libelle: d.libelle || "", description: d.description || "",
            code_regime: d.code_regime || "",
            date_debut_validite: d.date_debut_validite || "",
            date_fin_validite: d.date_fin_validite || "",
            decision_reference: d.decision_reference || "",
            actif: d.actif ?? true,
            mode_calcul: d.mode_calcul || "PERIODIQUE",
            code_rubrique_nb_paie: d.code_rubrique_nb_paie || null,
            code_rubrique_nb_jours: d.code_rubrique_nb_jours || null,
            code_rubrique_trentieme: d.code_rubrique_trentieme || null,
            code_rubrique_rapport: d.code_rubrique_rapport || null,
            valeur_defaut_nb_paie: d.valeur_defaut_nb_paie,
            valeur_defaut_nb_jours: d.valeur_defaut_nb_jours,
            valeur_defaut_trentieme: d.valeur_defaut_trentieme,
            valeur_defaut_rapport: d.valeur_defaut_rapport,
            assiette_negative_acceptee: d.assiette_negative_acceptee ?? false,
            assiette_negative_ramenee_zero: d.assiette_negative_ramenee_zero ?? false,
            prorata_temporis: d.prorata_temporis ?? false,
            minimum_salarial: d.minimum_salarial,
            minimum_patronal: d.minimum_patronal,
            maximum_salarial: d.maximum_salarial,
            maximum_patronal: d.maximum_patronal,
            code_bareme_taux: d.code_bareme_taux || null,
          });
        }
        setComposantes(((compos || []) as any[]).map(c => ({
          ...c, _id: c.id,
        })) as Composante[]);
        setLoading(false);
      }
    };
    init();
  }, [editId]);

  const addComposante = () => {
    const n = composantes.length;
    setComposantes(prev => [...prev, {
      _id: uid(), code: `COMPO_${n + 1}`,
      libelle: `Composante ${n + 1}`, ordre: n + 1,
      code_rubrique_assiette: null,
      taux_salarial: null, taux_patronal: null, plafond_mensuel: null,
      code_rubrique_part_salariale: null, code_rubrique_part_patronale: null,
      actif: true,
    }]);
  };

  const updateComposante = (id: string, patch: Partial<Composante>) =>
    setComposantes(prev => prev.map(c => c._id === id ? { ...c, ...patch } : c));

  const removeComposante = (id: string) =>
    setComposantes(prev => prev.filter(c => c._id !== id));

  const totalSal = composantes.reduce((s, c) => s + (c.taux_salarial || 0), 0);
  const totalPat = composantes.reduce((s, c) => s + (c.taux_patronal || 0), 0);

  // Listes filtrées par famille / type pour chaque sélecteur (RG-COTIS-RUB-01)
  const rubriquesSalariales = rubriques.filter(r => r.code_famille === "COT_SAL");
  const rubriquesPatronales = rubriques.filter(r => r.code_famille === "COT_PAT");
  const rubriquesAssiettes  = rubriques.filter(r => r.code_type === "ASS");

  const handleSave = async () => {
    if (!form.code.trim() || !form.libelle.trim()) {
      setError("Code et libellé sont obligatoires.");
      return;
    }
    if (composantes.length === 0) {
      setError("Au moins une composante est requise.");
      return;
    }
    setSaving(true); setError(null);

    const headerPayload: any = {
      libelle: form.libelle.trim(),
      description: form.description.trim() || null,
      code_regime: form.code_regime || null,
      date_debut_validite: form.date_debut_validite || null,
      date_fin_validite: form.date_fin_validite || null,
      decision_reference: form.decision_reference.trim() || null,
      actif: form.actif,
      // Modalités de calcul (RG-COTIS-MOD-01)
      mode_calcul: form.mode_calcul,
      code_rubrique_nb_paie: form.code_rubrique_nb_paie,
      code_rubrique_nb_jours: form.code_rubrique_nb_jours,
      code_rubrique_trentieme: form.code_rubrique_trentieme,
      code_rubrique_rapport: form.code_rubrique_rapport,
      valeur_defaut_nb_paie: form.valeur_defaut_nb_paie,
      valeur_defaut_nb_jours: form.valeur_defaut_nb_jours,
      valeur_defaut_trentieme: form.valeur_defaut_trentieme,
      valeur_defaut_rapport: form.valeur_defaut_rapport,
      assiette_negative_acceptee: form.assiette_negative_acceptee,
      assiette_negative_ramenee_zero: form.assiette_negative_ramenee_zero,
      prorata_temporis: form.prorata_temporis,
      minimum_salarial: form.minimum_salarial,
      minimum_patronal: form.minimum_patronal,
      maximum_salarial: form.maximum_salarial,
      maximum_patronal: form.maximum_patronal,
      code_bareme_taux: form.code_bareme_taux,
    };

    try {
      let regleId = editId;
      if (editId) {
        const { error: e } = await supabase.from("regle_calcul_cotisation" as never)
          .update(headerPayload as never).eq("id" as never, editId as never);
        if (e) throw e;
        await supabase.from("regle_calcul_cotisation_composante" as never)
          .delete().eq("id_regle" as never, editId as never);
      } else {
        const { data, error: e } = await supabase.from("regle_calcul_cotisation" as never)
          .insert({ ...headerPayload, code: form.code.toUpperCase().trim() } as never)
          .select("id" as never).single();
        if (e) throw e;
        regleId = (data as any).id;
      }

      if (regleId && composantes.length > 0) {
        const payload = composantes.map((c, i) => ({
          id_regle: regleId,
          code: (c.code || `COMPO_${i + 1}`).toUpperCase().trim(),
          libelle: c.libelle.trim() || `Composante ${i + 1}`,
          ordre: c.ordre,
          code_rubrique_assiette: c.code_rubrique_assiette,
          taux_salarial: c.taux_salarial,
          taux_patronal: c.taux_patronal,
          plafond_mensuel: c.plafond_mensuel,
          code_rubrique_part_salariale: c.code_rubrique_part_salariale,
          code_rubrique_part_patronale: c.code_rubrique_part_patronale,
          actif: c.actif,
        }));
        const { error: e } = await supabase.from("regle_calcul_cotisation_composante" as never)
          .insert(payload as never);
        if (e) throw e;
      }

      toast({ title: editId ? "Règle mise à jour" : "Règle créée" });
      onBack();
    } catch (err: any) {
      setError(err?.message?.includes("duplicate") ? "Ce code existe déjà." : (err?.message || "Erreur"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-muted-foreground">
      <Loader2 className="animate-spin mr-2" size={16} /> Chargement…
    </div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
            <ArrowLeft size={14} /> Retour
          </Button>
          <h2 className="text-base font-semibold text-foreground">
            {editId ? `Modifier : ${form.libelle || form.code}` : "Nouvelle règle de cotisation"}
          </h2>
        </div>
        <Button onClick={handleSave} disabled={saving} size="sm" className="gap-1.5">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm border"
          style={{ background: "hsl(0 84% 55% / 0.1)", color: "hsl(0 84% 45%)", borderColor: "hsl(0 84% 55% / 0.3)" }}>
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      <Tabs defaultValue="definition" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="definition">Définition</TabsTrigger>
          <TabsTrigger value="calcul">
            <Layers size={14} className="mr-1.5" /> Mode de calcul ({composantes.length})
          </TabsTrigger>
          <TabsTrigger value="modalites">Modalités</TabsTrigger>
          <TabsTrigger value="rubriques">Rubriques calculées</TabsTrigger>
        </TabsList>

        {/* Onglet Définition */}
        <TabsContent value="definition" className="mt-4">
          <div className="rounded-lg border bg-card p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="code" className="text-xs">Code *</Label>
                <Input id="code" value={form.code} disabled={!!editId}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="COT_CNSS" className="font-mono mt-1" />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="libelle" className="text-xs">Libellé *</Label>
                <Input id="libelle" value={form.libelle}
                  onChange={e => setForm(f => ({ ...f, libelle: e.target.value }))}
                  placeholder="CNSS — Régime général" className="mt-1" />
              </div>
              <div className="md:col-span-3">
                <Label htmlFor="description" className="text-xs">Description</Label>
                <Input id="description" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Cotisation CNSS regroupant Prestations Familiales, Long Terme et Court Terme" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="regime" className="text-xs">Régime de cotisation</Label>
                <select id="regime" value={form.code_regime}
                  onChange={e => setForm(f => ({ ...f, code_regime: e.target.value }))}
                  className="w-full h-9 mt-1 px-3 rounded-md border text-sm bg-background border-border text-foreground">
                  <option value="">— Sélectionner —</option>
                  {regimes.map(r => (
                    <option key={r.code} value={r.code}>
                      {r.libelle} {r.organisme ? `(${r.organisme})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2 flex items-end">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.actif}
                    onChange={e => setForm(f => ({ ...f, actif: e.target.checked }))}
                    className="rounded border-border text-accent" />
                  <span className="text-sm text-foreground">Règle active</span>
                </label>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Onglet Mode de calcul */}
        <TabsContent value="calcul" className="mt-4">
          <div className="rounded-lg border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Layers size={16} className="text-accent" /> Composantes ({composantes.length})
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Tranches/sous-cotisations — chacune avec son taux salarial, patronal et plafond.
                  {composantes.length > 0 && (
                    <span className="ml-2 font-mono">
                      Total sal: <strong>{totalSal.toFixed(2)} %</strong> · pat: <strong>{totalPat.toFixed(2)} %</strong>
                    </span>
                  )}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={addComposante}>
                <Plus className="mr-1 h-4 w-4" /> Composante
              </Button>
            </div>
            {composantes.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm border-2 border-dashed rounded-lg">
                Aucune composante — cliquez sur "+ Composante" pour ajouter une première tranche
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="w-12">#</TableHead>
                      <TableHead className="w-32">Code</TableHead>
                      <TableHead className="min-w-[280px]">Libellé</TableHead>
                      <TableHead className="w-64 min-w-[240px]">Assiette (rubrique)</TableHead>
                      <TableHead className="w-32 text-right">Tx Salarial</TableHead>
                      <TableHead className="w-32 text-right">Tx Patronal</TableHead>
                      <TableHead className="w-36 text-right">Plafond</TableHead>
                      <TableHead className="w-72 min-w-[260px]">Rubrique part Sal.</TableHead>
                      <TableHead className="w-72 min-w-[260px]">Rubrique part Pat.</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {composantes.map((c, idx) => (
                      <TableRow key={c._id}>
                        <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                        <TableCell>
                          <Input value={c.code} className="font-mono text-xs h-9"
                            onChange={e => updateComposante(c._id, { code: e.target.value.toUpperCase() })} />
                        </TableCell>
                        <TableCell className="min-w-[280px]">
                          <Input value={c.libelle} className="h-9"
                            onChange={e => updateComposante(c._id, { libelle: e.target.value })}
                            placeholder="ex: Prestations Familiales" />
                        </TableCell>
                        <TableCell>
                          <select value={c.code_rubrique_assiette || ""}
                            onChange={e => updateComposante(c._id, { code_rubrique_assiette: e.target.value || null })}
                            className="w-full h-9 px-2 rounded-md border text-xs bg-background border-border text-foreground"
                            title={rubriques.find(r => r.code === c.code_rubrique_assiette)?.libelle || ""}>
                            <option value="">— Aucune —</option>
                            {rubriquesAssiettes.map(r => (
                              <option key={r.code} value={r.code}>{r.libelle} ({r.code})</option>
                            ))}
                          </select>
                        </TableCell>
                        <TableCell>
                          <FormattedInput type="percent" decimales={4}
                            value={c.taux_salarial}
                            onChange={v => updateComposante(c._id, { taux_salarial: typeof v === "number" ? v : null })} />
                        </TableCell>
                        <TableCell>
                          <FormattedInput type="percent" decimales={4}
                            value={c.taux_patronal}
                            onChange={v => updateComposante(c._id, { taux_patronal: typeof v === "number" ? v : null })} />
                        </TableCell>
                        <TableCell>
                          <FormattedInput type="currency"
                            value={c.plafond_mensuel}
                            onChange={v => updateComposante(c._id, { plafond_mensuel: typeof v === "number" ? v : null })} />
                        </TableCell>
                        <TableCell>
                          <select value={c.code_rubrique_part_salariale || ""}
                            onChange={e => updateComposante(c._id, { code_rubrique_part_salariale: e.target.value || null })}
                            className="w-full h-9 px-2 rounded-md border text-xs bg-background border-border text-foreground"
                            title={rubriques.find(r => r.code === c.code_rubrique_part_salariale)?.libelle || ""}>
                            <option value="">— Aucune —</option>
                            {rubriquesSalariales.map(r => (
                              <option key={r.code} value={r.code}>{r.libelle} ({r.code})</option>
                            ))}
                          </select>
                        </TableCell>
                        <TableCell>
                          <select value={c.code_rubrique_part_patronale || ""}
                            onChange={e => updateComposante(c._id, { code_rubrique_part_patronale: e.target.value || null })}
                            className="w-full h-9 px-2 rounded-md border text-xs bg-background border-border text-foreground"
                            title={rubriques.find(r => r.code === c.code_rubrique_part_patronale)?.libelle || ""}>
                            <option value="">— Aucune —</option>
                            {rubriquesPatronales.map(r => (
                              <option key={r.code} value={r.code}>{r.libelle} ({r.code})</option>
                            ))}
                          </select>
                        </TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                            onClick={() => removeComposante(c._id)}>
                            <Trash2 size={13} />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="flex items-start gap-2 px-3 py-2 mt-3 rounded-lg text-xs"
              style={{ background: "hsl(var(--muted)/0.4)", color: "hsl(var(--muted-foreground))" }}>
              <Info size={12} className="mt-0.5 flex-shrink-0" />
              <span>
                Les <strong>rubriques de paie</strong> (parts salariale et patronale) sont
                optionnelles à ce stade — vous pouvez les définir maintenant ou plus tard.
                Elles permettront au moteur de paie d'imputer automatiquement le calcul sur
                les bonnes lignes du bulletin. Une synthèse est disponible dans l'onglet « Rubriques calculées ».
              </span>
            </div>
          </div>
        </TabsContent>

        {/* Onglet Modalités de calcul (RG-COTIS-MOD-01) */}
        <TabsContent value="modalites" className="mt-4">
          <div className="space-y-4">
            {/* Mode de calcul */}
            <div className="rounded-lg border bg-card p-5">
              <h3 className="font-semibold text-sm mb-3">Mode de calcul</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                  { v: "PERIODIQUE", l: "Périodique", d: "Calcul sur la période courante" },
                  { v: "CUMUL", l: "Cumul", d: "Cumul depuis début d'année (régularisations)" },
                  { v: "GLISSANT", l: "Glissant", d: "Sur 12 derniers mois glissants" },
                ].map(opt => (
                  <label key={opt.v}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      form.mode_calcul === opt.v
                        ? "border-accent bg-accent/5"
                        : "border-border hover:bg-muted/30"
                    }`}>
                    <div className="flex items-start gap-2">
                      <input type="radio" name="mode_calcul" value={opt.v}
                        checked={form.mode_calcul === opt.v}
                        onChange={() => setForm(f => ({ ...f, mode_calcul: opt.v as any }))}
                        className="mt-0.5" />
                      <div>
                        <div className="text-sm font-medium">{opt.l}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{opt.d}</div>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Base de calcul */}
            <div className="rounded-lg border bg-card p-5">
              <h3 className="font-semibold text-sm mb-3">Base de calcul</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Liez chaque base à une rubrique de paie OU saisissez une valeur par défaut
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/30">
                      <th className="text-left py-2 px-3 text-xs font-semibold w-32">Base</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold">Rubrique</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold w-40">Valeur par défaut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { lib: "Nb paie",    rkey: "code_rubrique_nb_paie",   vkey: "valeur_defaut_nb_paie",   placeholder: "12.00" },
                      { lib: "Nb jours",   rkey: "code_rubrique_nb_jours",  vkey: "valeur_defaut_nb_jours",  placeholder: "26.00" },
                      { lib: "Trentième",  rkey: "code_rubrique_trentieme", vkey: "valeur_defaut_trentieme", placeholder: "30.00" },
                      { lib: "Rapport",    rkey: "code_rubrique_rapport",   vkey: "valeur_defaut_rapport",   placeholder: "1.0000" },
                    ].map(row => (
                      <tr key={row.rkey} className="border-t">
                        <td className="py-2 px-3 text-xs font-medium">{row.lib}</td>
                        <td className="py-2 px-3">
                          <select value={(form as any)[row.rkey] || ""}
                            onChange={e => setForm(f => ({ ...f, [row.rkey]: e.target.value || null }))}
                            className="w-full h-9 px-2 rounded-md border text-xs bg-background border-border text-foreground"
                            title={rubriquesAll.find(r => r.code === (form as any)[row.rkey])?.libelle || ""}>
                            <option value="">— Aucune —</option>
                            {rubriquesAll.map(r => (
                              <option key={r.code} value={r.code}>{r.libelle} ({r.code})</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 px-3">
                          <FormattedInput type="number" decimales={4}
                            value={(form as any)[row.vkey]}
                            onChange={v => setForm(f => ({ ...f, [row.vkey]: typeof v === "number" ? v : null }))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Options et Min/Max sur 2 colonnes */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Options */}
              <div className="rounded-lg border bg-card p-5">
                <h3 className="font-semibold text-sm mb-3">Options de calcul</h3>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.assiette_negative_acceptee}
                      onChange={e => setForm(f => ({ ...f, assiette_negative_acceptee: e.target.checked }))}
                      className="rounded border-border text-accent" />
                    <span className="text-sm">Assiette négative acceptée</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.assiette_negative_ramenee_zero}
                      onChange={e => setForm(f => ({ ...f, assiette_negative_ramenee_zero: e.target.checked }))}
                      className="rounded border-border text-accent" />
                    <span className="text-sm">Assiette négative ramenée à zéro</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.prorata_temporis}
                      onChange={e => setForm(f => ({ ...f, prorata_temporis: e.target.checked }))}
                      className="rounded border-border text-accent" />
                    <span className="text-sm">Calcul au prorata temporis</span>
                  </label>
                </div>
              </div>

              {/* Min/Max */}
              <div className="rounded-lg border bg-card p-5">
                <h3 className="font-semibold text-sm mb-3">Min / Max cotisation</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      <th className="text-left py-1"></th>
                      <th className="text-right py-1 px-2">Salariale</th>
                      <th className="text-right py-1 px-2">Patronale</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="py-1 text-xs font-medium">Minimum</td>
                      <td className="py-1 px-2">
                        <FormattedInput type="currency"
                          value={form.minimum_salarial}
                          onChange={v => setForm(f => ({ ...f, minimum_salarial: typeof v === "number" ? v : null }))} />
                      </td>
                      <td className="py-1 px-2">
                        <FormattedInput type="currency"
                          value={form.minimum_patronal}
                          onChange={v => setForm(f => ({ ...f, minimum_patronal: typeof v === "number" ? v : null }))} />
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1 text-xs font-medium">Maximum</td>
                      <td className="py-1 px-2">
                        <FormattedInput type="currency"
                          value={form.maximum_salarial}
                          onChange={v => setForm(f => ({ ...f, maximum_salarial: typeof v === "number" ? v : null }))} />
                      </td>
                      <td className="py-1 px-2">
                        <FormattedInput type="currency"
                          value={form.maximum_patronal}
                          onChange={v => setForm(f => ({ ...f, maximum_patronal: typeof v === "number" ? v : null }))} />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Barème de taux */}
            <div className="rounded-lg border bg-card p-5">
              <h3 className="font-semibold text-sm mb-1">Barème de taux (optionnel)</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Pour les cotisations à tranches (IR Maroc, CIMR…), liez un barème.
                Les taux fixes des composantes seront alors ignorés au profit des tranches du barème.
              </p>
              <select value={form.code_bareme_taux || ""}
                onChange={e => setForm(f => ({ ...f, code_bareme_taux: e.target.value || null }))}
                className="w-full h-9 px-3 rounded-md border text-sm bg-background border-border text-foreground">
                <option value="">— Aucun (taux fixes des composantes) —</option>
                {baremes.map(b => (
                  <option key={b.code} value={b.code}>{b.libelle} ({b.code})</option>
                ))}
              </select>
            </div>
          </div>
        </TabsContent>

        {/* Onglet Rubriques calculées */}
        <TabsContent value="rubriques" className="mt-4">
          <div className="rounded-lg border bg-card p-5">
            <div className="mb-4">
              <h3 className="font-semibold text-sm">Rubriques calculées</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Synthèse des rubriques de paie qui recevront le calcul de chaque composante.
                Modifiez les liaisons depuis l'onglet « Mode de calcul ».
              </p>
            </div>
            {composantes.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm border-2 border-dashed rounded-lg">
                Aucune composante définie — ajoutez-en depuis l'onglet « Mode de calcul »
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="w-32">Code</TableHead>
                      <TableHead>Libellé</TableHead>
                      <TableHead className="w-28 text-right">Tx Sal</TableHead>
                      <TableHead className="w-28 text-right">Tx Pat</TableHead>
                      <TableHead>Rubrique part Salariale</TableHead>
                      <TableHead>Rubrique part Patronale</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {composantes.map((c, idx) => {
                      const rubSal = rubriquesSalariales.find(r => r.code === c.code_rubrique_part_salariale);
                      const rubPat = rubriquesPatronales.find(r => r.code === c.code_rubrique_part_patronale);
                      return (
                        <TableRow key={c._id}>
                          <TableCell className="font-mono text-xs">{c.code}</TableCell>
                          <TableCell>{c.libelle}</TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {c.taux_salarial != null ? `${Number(c.taux_salarial).toFixed(2)} %` : "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {c.taux_patronal != null ? `${Number(c.taux_patronal).toFixed(2)} %` : "—"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {rubSal ? (
                              <span><strong>{rubSal.libelle}</strong> <span className="text-muted-foreground font-mono">({rubSal.code})</span></span>
                            ) : <span className="text-muted-foreground italic">— Non liée —</span>}
                          </TableCell>
                          <TableCell className="text-xs">
                            {rubPat ? (
                              <span><strong>{rubPat.libelle}</strong> <span className="text-muted-foreground font-mono">({rubPat.code})</span></span>
                            ) : <span className="text-muted-foreground italic">— Non liée —</span>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Validité — déplacé hors des onglets, en bas du formulaire */}
      <section className="rounded-lg border bg-card overflow-hidden">
        <button type="button" onClick={() => toggleSection("validite")}
          className="w-full flex items-center gap-2 px-5 py-3 hover:bg-muted/30 transition-colors">
          {openSections.validite ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <h3 className="font-semibold text-sm">Validité & Référence</h3>
        </button>
        {openSections.validite && (
          <div className="px-5 pb-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="dd" className="text-xs">Date de début de validité</Label>
                <Input id="dd" type="date" min="1950-01-01" max="2099-12-31"
                  value={form.date_debut_validite}
                  onChange={e => setForm(f => ({ ...f, date_debut_validite: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="df" className="text-xs">Date de fin de validité</Label>
                <Input id="df" type="date" min="1950-01-01" max="2099-12-31"
                  value={form.date_fin_validite}
                  onChange={e => setForm(f => ({ ...f, date_fin_validite: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="ref" className="text-xs">Référence décision</Label>
                <Input id="ref" value={form.decision_reference}
                  onChange={e => setForm(f => ({ ...f, decision_reference: e.target.value }))}
                  placeholder="Décret n°2-26-XYZ du …" className="mt-1" />
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

export default RegleCotisationForm;
