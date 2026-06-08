/**
 * RegleSpecifiqueForm – Éditeur multi-instructions des règles spécifiques.
 * Deux modes : TABLEUR (lignes numérotées) et TEXTE (script libre).
 * Supporte registres R01-R99, accesseurs MT./NB./MTC./NBC./TY.<RUB>, opérateurs @MIN @MAX @TAB et BRANCH.
 */
import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Save, Loader2, Info, Plus, Trash2, ArrowUp, ArrowDown, FileText, Table2, Play, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import SimulationPanel from "./SimulationPanel";

interface Props {
  editId: string | null;
  duplicateId: string | null;
  onBack: () => void;
}

interface Instruction {
  id?: string;
  numero: number;
  instruction: string;
  label: string | null;
  commentaire: string | null;
  est_actif: boolean;
  _new?: boolean;
  _deleted?: boolean;
}

const SYNTAX_HELP = [
  { syntax: "Rxx",                        desc: "Registre de travail (R01 à R99)" },
  { syntax: "MT.<RUB>  /  MTC.<RUB>",      desc: "Montant rubrique courante / cumul" },
  { syntax: "NB.<RUB>  /  NBC.<RUB>",      desc: "Nombre rubrique courante / cumul" },
  { syntax: "TY.<RUB>",                    desc: "Taux rubrique" },
  { syntax: "MTP.<RUB>  /  NBP.<RUB>",     desc: "Montant / Nombre de la précédente paie" },
  { syntax: "TYP.<RUB>  /  DTP.<RUB>",     desc: "Taux / Date de la précédente paie" },
  { syntax: "BASE / TAUX / NOMBRE / MT",   desc: "Variables de la rubrique courante" },
  { syntax: "+  −  *  /  %",               desc: "Opérateurs arithmétiques (% = pourcentage)" },
  { syntax: "@MIN  @MAX",                  desc: "Min/Max de deux opérandes" },
  { syntax: "@TAB <BAREME>",               desc: "Recherche dans un barème (ex: TY = MT @TAB IGR)" },
  { syntax: "SI <cond> BRANCH <label>",    desc: "Branchement conditionnel (label FIN, etc.)" },
  { syntax: "BRANCH <label>",              desc: "Branchement inconditionnel (alias GOTO / ALLER)" },
  { syntax: "FIN  /  END  /  STOP",        desc: "Fin de traitement explicite (sortie immédiate)" },
  { syntax: "BRANCH FIN",                  desc: "Saut direct vers la fin du traitement" },
  { syntax: "DATEJOUR / DATEPAIE",         desc: "Date du jour / date de paie courante" },
];

// Validation syntaxique sommaire d'une instruction (mini-langage)
const VALID_INSTR = /^(R\d{2}\s*=|SI\s+.+BRANCH\s+\w+|MT\s*=|NB\s*=|TY\s*=|BASE\s*=|.+)/i;

const RegleSpecifiqueForm: React.FC<Props> = ({ editId, duplicateId, onBack }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [simOpen, setSimOpen] = useState(false);
  const [mode, setMode] = useState<"TABLEUR" | "TEXTE">("TABLEUR");
  const [form, setForm] = useState({
    code: "",
    libelle: "",
    description: "",
    attribut_calcule: "MONTANT",
    expression: "",
    instructions_text: "",
    date_application: "",
    date_debut_validite: "",
    date_fin_validite: "",
    decision_reference: "",
    commentaire: "",
    actif: true,
    // Workflow de validation
    statut: "BROUILLON" as "BROUILLON" | "VALIDEE" | "ARCHIVEE",
    date_validation: null as string | null,
    valide_par: null as string | null,
    commentaire_validation: "",
  });
  const [instructions, setInstructions] = useState<Instruction[]>([]);

  useEffect(() => {
    const id = editId || duplicateId;
    if (!id) {
      // Initial : une ligne vide en mode tableur
      setInstructions([{ numero: 10, instruction: "", label: null, commentaire: null, est_actif: true, _new: true }]);
      return;
    }
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("regle_calcul_specifique" as any)
        .select("*")
        .eq("id", id)
        .single();
      if (error || !data) {
        toast({ title: "Erreur", description: error?.message || "Règle introuvable", variant: "destructive" });
        setLoading(false);
        return;
      }
      setForm({
        code: duplicateId ? `${data.code}_COPY` : data.code,
        libelle: duplicateId ? `${data.libelle} (copie)` : data.libelle,
        description: data.description || "",
        attribut_calcule: data.attribut_calcule,
        expression: data.expression || "",
        instructions_text: (data as any).instructions_text || "",
        date_application: (data as any).date_application || "",
        date_debut_validite: data.date_debut_validite || "",
        date_fin_validite: data.date_fin_validite || "",
        decision_reference: data.decision_reference || "",
        commentaire: data.commentaire || "",
        actif: data.actif,
        // Workflow de validation - une duplication revient à BROUILLON
        statut: duplicateId ? "BROUILLON" : ((data as any).statut || "BROUILLON"),
        date_validation: duplicateId ? null : ((data as any).date_validation || null),
        valide_par: duplicateId ? null : ((data as any).valide_par || null),
        commentaire_validation: duplicateId ? "" : ((data as any).commentaire_validation || ""),
      });
      setMode(((data as any).mode_edition || "TABLEUR") as "TABLEUR" | "TEXTE");

      // Charger les instructions ligne par ligne
      const { data: instr } = await supabase
        .from("regle_specifique_instruction" as any)
        .select("*")
        .eq("regle_id", id)
        .order("numero");

      if (instr && (instr as any[]).length) {
        setInstructions(
          (instr as any[]).map((i: any) => ({
            id: duplicateId ? undefined : i.id,
            numero: i.numero,
            instruction: i.instruction,
            label: i.label,
            commentaire: i.commentaire,
            est_actif: i.est_actif,
            _new: !!duplicateId,
          }))
        );
      } else {
        setInstructions([{ numero: 10, instruction: "", label: null, commentaire: null, est_actif: true, _new: true }]);
      }
      setLoading(false);
    })();
  }, [editId, duplicateId]);

  // ----- Tableur helpers -----
  const updateInstr = (idx: number, patch: Partial<Instruction>) => {
    setInstructions((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };
  const addInstr = () => {
    const visible = instructions.filter((i) => !i._deleted);
    const lastNum = visible.length ? Math.max(...visible.map((i) => i.numero)) : 0;
    setInstructions((prev) => [
      ...prev,
      { numero: lastNum + 5, instruction: "", label: null, commentaire: null, est_actif: true, _new: true },
    ]);
  };
  const removeInstr = (idx: number) => {
    setInstructions((prev) => {
      const it = prev[idx];
      if (it.id) return prev.map((x, i) => (i === idx ? { ...x, _deleted: true } : x));
      return prev.filter((_, i) => i !== idx);
    });
  };
  const moveInstr = (idx: number, dir: -1 | 1) => {
    const visible = instructions.filter((i) => !i._deleted);
    const realIdx = instructions.indexOf(visible[idx]);
    const targetVisIdx = idx + dir;
    if (targetVisIdx < 0 || targetVisIdx >= visible.length) return;
    const realTarget = instructions.indexOf(visible[targetVisIdx]);
    setInstructions((prev) => {
      const next = [...prev];
      const a = next[realIdx].numero;
      next[realIdx] = { ...next[realIdx], numero: next[realTarget].numero };
      next[realTarget] = { ...next[realTarget], numero: a };
      return next.sort((x, y) => x.numero - y.numero);
    });
  };

  // ----- Synchronisation TABLEUR <-> TEXTE -----
  const tableurToText = () => {
    return instructions
      .filter((i) => !i._deleted)
      .sort((a, b) => a.numero - b.numero)
      .map((i) => `${String(i.numero).padStart(3, " ")}  ${i.instruction}${i.label ? `   :${i.label}` : ""}${i.commentaire ? `   ; ${i.commentaire}` : ""}`)
      .join("\n");
  };
  const textToTableur = (txt: string): Instruction[] => {
    const lines = txt.split("\n").map((l) => l.trim()).filter(Boolean);
    return lines.map((l, idx) => {
      // Format attendu : "<num>  <instruction>   :LABEL   ; commentaire"
      const m = l.match(/^(\d+)\s+(.+)$/);
      let numero = (idx + 1) * 10;
      let body = l;
      if (m) {
        numero = parseInt(m[1], 10);
        body = m[2];
      }
      let commentaire: string | null = null;
      let label: string | null = null;
      const cIdx = body.indexOf(";");
      if (cIdx >= 0) {
        commentaire = body.slice(cIdx + 1).trim();
        body = body.slice(0, cIdx).trim();
      }
      const lblMatch = body.match(/\s:(\w+)\s*$/);
      if (lblMatch) {
        label = lblMatch[1];
        body = body.replace(/\s:\w+\s*$/, "").trim();
      }
      return { numero, instruction: body, label, commentaire, est_actif: true, _new: true };
    });
  };

  const handleModeSwitch = (next: "TABLEUR" | "TEXTE") => {
    if (next === mode) return;
    if (next === "TEXTE") {
      setForm((f) => ({ ...f, instructions_text: tableurToText() }));
    } else {
      // Repasser en tableur : reconstruire depuis le texte
      const reb = textToTableur(form.instructions_text);
      setInstructions(reb.length ? reb : [{ numero: 10, instruction: "", label: null, commentaire: null, est_actif: true, _new: true }]);
    }
    setMode(next);
  };

  // Validation : numéros uniques + au moins une instruction non vide
  const validate = (): string | null => {
    const visible = mode === "TABLEUR"
      ? instructions.filter((i) => !i._deleted && i.instruction.trim())
      : textToTableur(form.instructions_text);
    if (!form.code.trim() || !form.libelle.trim()) return "Code et libellé sont obligatoires.";
    if (visible.length === 0) return "Au moins une instruction est requise.";
    const nums = visible.map((i) => i.numero);
    if (new Set(nums).size !== nums.length) return "Les numéros de ligne doivent être uniques.";
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) {
      toast({ title: "Validation", description: err, variant: "destructive" });
      return;
    }
    setSaving(true);

    // 1) Synchroniser texte/tableur avant envoi
    let finalInstructions: Instruction[];
    let finalText: string;
    if (mode === "TABLEUR") {
      finalInstructions = instructions.filter((i) => !i._deleted && i.instruction.trim());
      finalText = tableurToText();
    } else {
      finalInstructions = textToTableur(form.instructions_text);
      finalText = form.instructions_text;
    }

    // L'expression "courte" reste = concaténation des instructions (rétro-compat colonne expression)
    const expressionSummary = finalInstructions.map((i) => i.instruction).join(" ; ");

    // Inférer la (les) sortie(s) depuis les instructions finales
    const inferredSet = new Set<string>();
    finalInstructions.forEach((i) => {
      const m = i.instruction.trim().match(/^(MT|NB|TY|BASE)\s*=/i);
      if (m) inferredSet.add(m[1].toUpperCase());
    });
    const inferred = Array.from(inferredSet);
    const attributCalcule =
      inferred.length === 0 ? "AUCUN" :
      inferred.length === 1 ? (inferred[0] === "MT" ? "MONTANT" : inferred[0] === "NB" ? "NOMBRE" : inferred[0] === "TY" ? "TAUX" : "BASE") :
      "MULTI";

    const payload: any = {
      code: form.code,
      libelle: form.libelle,
      description: form.description || null,
      attribut_calcule: attributCalcule,
      expression: expressionSummary,
      mode_edition: mode,
      instructions_text: finalText,
      date_application: form.date_application || null,
      date_debut_validite: form.date_debut_validite || null,
      date_fin_validite: form.date_fin_validite || null,
      decision_reference: form.decision_reference || null,
      commentaire: form.commentaire || null,
      actif: form.actif,
      // Workflow de validation
      // Si on modifie une règle VALIDEE, on la repasse en BROUILLON
      // pour qu'elle soit re-validée avant d'être utilisée en paie
      statut: editId && form.statut === "VALIDEE" ? "BROUILLON" : form.statut,
      date_validation: editId && form.statut === "VALIDEE" ? null : form.date_validation,
      valide_par: editId && form.statut === "VALIDEE" ? null : form.valide_par,
      commentaire_validation: editId && form.statut === "VALIDEE" ? null : (form.commentaire_validation || null),
    };

    let regleId = editId;
    if (editId) {
      const { error } = await supabase.from("regle_calcul_specifique").update(payload).eq("id", editId);
      if (error) {
        setSaving(false);
        toast({ title: "Erreur d'enregistrement", description: error.message, variant: "destructive" });
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("regle_calcul_specifique" as any)
        .insert(payload)
        .select("id")
        .single();
      if (error || !data) {
        setSaving(false);
        toast({ title: "Erreur d'enregistrement", description: error?.message || "Échec création", variant: "destructive" });
        return;
      }
      regleId = (data as any).id;
    }

    // 2) Synchroniser les instructions en base
    if (regleId) {
      // Suppressions
      const toDelete = instructions.filter((i) => i._deleted && i.id).map((i) => i.id!);
      if (toDelete.length) {
        await supabase.from("regle_specifique_instruction").delete().in("id", toDelete);
      }
      // Upserts (on remplace tout par finalInstructions pour rester simple)
      // Stratégie : delete-all puis insert-all si on est en mode TEXTE ou édition complexe
      await supabase.from("regle_specifique_instruction").delete().eq("regle_id", regleId);
      if (finalInstructions.length) {
        await supabase.from("regle_specifique_instruction").insert(
          finalInstructions.map((i) => ({
            regle_id: regleId!,
            numero: i.numero,
            instruction: i.instruction,
            label: i.label,
            commentaire: i.commentaire,
            est_actif: i.est_actif,
          }))
        );
      }
    }

    setSaving(false);
    toast({ title: editId ? "Règle modifiée" : "Règle créée" });
    onBack();
  };

  // Valider la règle (passer de BROUILLON à VALIDEE)
  // Une règle VALIDEE est utilisée par le moteur de paie réel.
  const handleValider = async () => {
    if (!editId) {
      toast({ title: "Validation impossible", description: "Veuillez d'abord enregistrer la règle.", variant: "destructive" });
      return;
    }
    if (!confirm("Valider cette règle ? Elle sera utilisée dans le calcul de paie.")) return;

    setSaving(true);
    const commentaire = window.prompt("Commentaire de validation (optionnel) :", "") || null;

    // Récupérer l'utilisateur courant (auth Supabase)
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id || null;

    const { error } = await supabase
      .from("regle_calcul_specifique")
      .update({
        statut: "VALIDEE",
        date_validation: new Date().toISOString(),
        valide_par: userId,
        commentaire_validation: commentaire,
        actif: true,
      } as any)
      .eq("id", editId);

    setSaving(false);
    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Règle validée", description: "Cette règle est maintenant utilisée en production." });
    setForm((f) => ({
      ...f,
      statut: "VALIDEE",
      date_validation: new Date().toISOString(),
      valide_par: userId,
      commentaire_validation: commentaire || "",
      actif: true,
    }));
  };

  // Archiver la règle (passer de VALIDEE à ARCHIVEE)
  // Une règle archivée n'est plus utilisée en production.
  const handleArchiver = async () => {
    if (!editId) return;
    if (!confirm("Archiver cette règle ? Elle ne sera plus utilisée dans le calcul de paie.")) return;

    setSaving(true);
    const { error } = await supabase
      .from("regle_calcul_specifique")
      .update({
        statut: "ARCHIVEE",
        actif: false,
      } as any)
      .eq("id", editId);

    setSaving(false);
    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Règle archivée" });
    setForm((f) => ({ ...f, statut: "ARCHIVEE", actif: false }));
  };

  // Réactiver une règle archivée (passer de ARCHIVEE à BROUILLON)
  const handleReactiver = async () => {
    if (!editId) return;
    if (!confirm("Réactiver cette règle ? Elle devra être re-validée avant utilisation.")) return;

    setSaving(true);
    const { error } = await supabase
      .from("regle_calcul_specifique")
      .update({
        statut: "BROUILLON",
        date_validation: null,
        valide_par: null,
        commentaire_validation: null,
        actif: false,
      } as any)
      .eq("id", editId);

    setSaving(false);
    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Règle réactivée", description: "Vous pouvez maintenant la modifier puis la valider." });
    setForm((f) => ({
      ...f,
      statut: "BROUILLON",
      date_validation: null,
      valide_par: null,
      commentaire_validation: "",
      actif: false,
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="animate-spin mr-2" size={18} /> Chargement…
      </div>
    );
  }

  const visibleInstr = instructions.filter((i) => !i._deleted);

  // Inférence des sorties à partir des instructions (MT=, NB=, TY=, BASE=)
  const sourceForDetect = mode === "TABLEUR"
    ? visibleInstr.map((i) => i.instruction).join("\n")
    : form.instructions_text;
  const OUTPUT_LABELS: Record<string, string> = {
    MT: "Montant",
    NB: "Nombre",
    TY: "Taux",
    BASE: "Base",
  };
  const detectedSet = new Set<string>();
  sourceForDetect.split(/[\n;]/).forEach((line) => {
    const m = line.trim().match(/^(MT|NB|TY|BASE)\s*=/i);
    if (m) detectedSet.add(m[1].toUpperCase());
  });
  const detectedOutputs = Array.from(detectedSet).map((k) => `${k} (${OUTPUT_LABELS[k]})`);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-5">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowLeft size={14} /> Retour
        </Button>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSimOpen(true)}
            className="gap-1.5"
            title="Tester la règle avant mise en production (sandbox)"
          >
            <Play size={14} /> Simuler
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
            {editId ? "Enregistrer" : "Créer"}
          </Button>
        </div>
      </div>

      <h2 className="text-lg font-semibold text-foreground mb-1">
        {editId ? "Modifier" : duplicateId ? "Dupliquer" : "Nouvelle"} règle spécifique
      </h2>
      <p className="text-xs text-muted-foreground mb-5">
        Composez votre règle ligne par ligne (tableur) ou en script libre (texte).
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Colonne principale */}
        <div className="lg:col-span-2 space-y-4">
          {/* Identité */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="code" className="text-xs">Code <span className="text-destructive">*</span></Label>
              <Input id="code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="EX: REGLE_IGR" className="h-9 text-sm font-mono" />
            </div>
            <div>
              <Label htmlFor="libelle" className="text-xs">Libellé <span className="text-destructive">*</span></Label>
              <Input id="libelle" value={form.libelle} onChange={(e) => setForm({ ...form, libelle: e.target.value })}
                placeholder="Calcul de l'IGR" className="h-9 text-sm" />
            </div>
          </div>

          <div>
            <Label htmlFor="description" className="text-xs">Description</Label>
            <Textarea id="description" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Décrivez la finalité de cette règle…" className="text-sm min-h-[60px]" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">Sorties détectées</Label>
              <div className="flex flex-wrap gap-1.5 min-h-[36px] items-center px-3 py-2 rounded-lg border border-dashed border-border bg-muted/20">
                {detectedOutputs.length === 0 ? (
                  <span className="text-[11px] text-muted-foreground italic">
                    Aucune sortie détectée — utilisez <code className="font-mono">MT =</code>, <code className="font-mono">NB =</code>, <code className="font-mono">TY =</code> ou <code className="font-mono">BASE =</code>
                  </span>
                ) : (
                  detectedOutputs.map((o) => (
                    <Badge key={o} variant="secondary" className="text-[10px] font-mono">
                      {o}
                    </Badge>
                  ))
                )}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 italic">
                Inférées depuis vos instructions — pas besoin de les déclarer.
              </p>
            </div>
            <div>
              <Label htmlFor="dapp" className="text-xs">Date d'application</Label>
              <Input id="dapp" type="date" value={form.date_application}
                onChange={(e) => setForm({ ...form, date_application: e.target.value })}
                className="h-9 text-sm" />
            </div>
          </div>

          {/* Bascule de mode */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <Label className="text-sm font-semibold">Instructions de la règle</Label>
            <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/30">
              <button type="button" onClick={() => handleModeSwitch("TABLEUR")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
                  mode === "TABLEUR" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}>
                <Table2 size={13} /> Tableur
              </button>
              <button type="button" onClick={() => handleModeSwitch("TEXTE")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
                  mode === "TEXTE" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}>
                <FileText size={13} /> Texte libre
              </button>
            </div>
          </div>

          {/* Mode TABLEUR */}
          {mode === "TABLEUR" && (
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-2 font-semibold w-14">N°</th>
                    <th className="px-2 py-2 font-semibold">Instruction</th>
                    <th className="px-2 py-2 font-semibold w-20">Label</th>
                    <th className="px-2 py-2 font-semibold w-12 text-center">✓</th>
                    <th className="px-2 py-2 font-semibold w-24 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleInstr.map((it, vIdx) => {
                    const realIdx = instructions.indexOf(it);
                    const isValid = !it.instruction.trim() || VALID_INSTR.test(it.instruction.trim());
                    return (
                      <tr key={`${realIdx}-${it.numero}`} className="hover:bg-muted/20">
                        <td className="px-2 py-1.5">
                          <Input type="number" value={it.numero}
                            onChange={(e) => updateInstr(realIdx, { numero: parseInt(e.target.value, 10) || 0 })}
                            className="h-8 text-xs font-mono w-14 text-center" />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input value={it.instruction}
                            onChange={(e) => updateInstr(realIdx, { instruction: e.target.value })}
                            placeholder="Ex: R10 = MT.IGRA + MTC.IGRA"
                            className={`h-8 text-xs font-mono ${!isValid ? "border-destructive/60" : ""}`} />
                          {it.commentaire && (
                            <div className="text-[10px] text-muted-foreground mt-0.5 ml-1 italic">; {it.commentaire}</div>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <Input value={it.label || ""}
                            onChange={(e) => updateInstr(realIdx, { label: e.target.value || null })}
                            placeholder="—"
                            className="h-8 text-[11px] font-mono w-20" />
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <Switch checked={it.est_actif}
                            onCheckedChange={(v) => updateInstr(realIdx, { est_actif: v })} />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center justify-end gap-0.5">
                            <Button size="icon" variant="ghost" className="h-7 w-7"
                              onClick={() => moveInstr(vIdx, -1)} disabled={vIdx === 0} title="Monter">
                              <ArrowUp size={12} />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7"
                              onClick={() => moveInstr(vIdx, 1)} disabled={vIdx === visibleInstr.length - 1} title="Descendre">
                              <ArrowDown size={12} />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => removeInstr(realIdx)} title="Supprimer">
                              <Trash2 size={12} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="flex items-center justify-between p-2 bg-muted/20 border-t border-border">
                <span className="text-[11px] text-muted-foreground">
                  {visibleInstr.length} ligne{visibleInstr.length > 1 ? "s" : ""}
                </span>
                <Button size="sm" variant="outline" onClick={addInstr} className="gap-1.5 h-8">
                  <Plus size={13} /> Ajouter une ligne
                </Button>
              </div>
            </div>
          )}

          {/* Mode TEXTE */}
          {mode === "TEXTE" && (
            <div>
              <Textarea value={form.instructions_text}
                onChange={(e) => setForm({ ...form, instructions_text: e.target.value })}
                placeholder={`10  R10 = MT.IGRA + MTC.IGRA\n20  R11 = R10 - R12\n30  SI R02 = 0 BRANCH FIN   :FIN\n40  MT = R01 / R02`}
                className="text-xs font-mono min-h-[260px] leading-relaxed" />
              <p className="text-[11px] text-muted-foreground mt-1">
                Format : <code>numéro  instruction  :LABEL  ; commentaire</code>. Une ligne par instruction.
              </p>
            </div>
          )}

          {/* Validité */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border">
            <div>
              <Label htmlFor="dd" className="text-xs">Date début validité</Label>
              <Input id="dd" type="date" value={form.date_debut_validite}
                onChange={(e) => setForm({ ...form, date_debut_validite: e.target.value })}
                className="h-9 text-sm" />
            </div>
            <div>
              <Label htmlFor="df" className="text-xs">Date fin validité</Label>
              <Input id="df" type="date" value={form.date_fin_validite}
                onChange={(e) => setForm({ ...form, date_fin_validite: e.target.value })}
                className="h-9 text-sm" />
            </div>
          </div>

          <div>
            <Label htmlFor="decision" className="text-xs">Référence de décision</Label>
            <Input id="decision" value={form.decision_reference}
              onChange={(e) => setForm({ ...form, decision_reference: e.target.value })}
              placeholder="Note interne, Convention CCN art…" className="h-9 text-sm" />
          </div>

          <div>
            <Label htmlFor="commentaire" className="text-xs">Commentaire interne</Label>
            <Textarea id="commentaire" value={form.commentaire}
              onChange={(e) => setForm({ ...form, commentaire: e.target.value })}
              className="text-sm min-h-[60px]" />
          </div>

          {/* Workflow de validation */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <Label className="text-sm font-medium">Statut de la règle</Label>
                <p className="text-[11px] text-muted-foreground">
                  Seules les règles VALIDÉES sont utilisées dans le calcul de paie.
                </p>
              </div>
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
                style={
                  form.statut === "VALIDEE"
                    ? { background: "hsl(145 60% 90%)", color: "hsl(145 60% 30%)" }
                    : form.statut === "ARCHIVEE"
                    ? { background: "hsl(0 0% 90%)", color: "hsl(0 0% 40%)" }
                    : { background: "hsl(45 95% 90%)", color: "hsl(35 85% 35%)" }
                }
              >
                {form.statut === "VALIDEE" && "✓ Validée — En production"}
                {form.statut === "ARCHIVEE" && "○ Archivée"}
                {form.statut === "BROUILLON" && "✎ Brouillon"}
              </span>
            </div>

            {form.statut === "VALIDEE" && form.date_validation && (
              <div className="text-[11px] text-muted-foreground bg-background/60 rounded p-2 border border-border">
                <p>
                  Validée le{" "}
                  <strong>{new Date(form.date_validation).toLocaleString("fr-FR")}</strong>
                </p>
                {form.commentaire_validation && (
                  <p className="mt-1 italic">"{form.commentaire_validation}"</p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {form.statut === "BROUILLON" && editId && (
                <Button
                  size="sm"
                  type="button"
                  onClick={handleValider}
                  disabled={saving}
                  className="gap-1.5"
                  style={{ background: "hsl(145 60% 42%)", color: "white" }}
                >
                  ✓ Valider la règle
                </Button>
              )}
              {form.statut === "VALIDEE" && (
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={handleArchiver}
                  disabled={saving}
                  className="gap-1.5"
                >
                  📦 Archiver
                </Button>
              )}
              {form.statut === "ARCHIVEE" && (
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={handleReactiver}
                  disabled={saving}
                  className="gap-1.5"
                >
                  ↺ Réactiver (en brouillon)
                </Button>
              )}
              {!editId && (
                <p className="text-[11px] text-muted-foreground italic">
                  Enregistrez la règle pour pouvoir la valider.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Aide à la syntaxe */}
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 sticky top-4 space-y-4">
            <div className="flex items-center gap-2">
              <Info size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-foreground">Syntaxe disponible</h3>
            </div>
            <ul className="space-y-2.5">
              {SYNTAX_HELP.map((v) => (
                <li key={v.syntax}>
                  <code className="text-[11px] font-mono text-accent block">{v.syntax}</code>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{v.desc}</p>
                </li>
              ))}
            </ul>

            <div className="pt-3 border-t border-accent/20">
              <h4 className="text-[11px] font-semibold text-foreground mb-1.5 flex items-center gap-1.5">
                <Play size={11} /> Exemple (calcul IGR)
              </h4>
              <pre className="text-[10px] font-mono leading-relaxed text-muted-foreground bg-background/50 p-2 rounded border border-border whitespace-pre">{`10  R10 = MT.IGRA + MTC.IGRA
15  R12 = MT.FP + MTC.FP
20  R11 = R10 - R12
45  R21 = R11 % 10
50  R22 = R20 @MIN R21
55  R01 = R11 - R22
250 SI R02 = 0 BRANCH FIN
300 MT = R01 / R02
500 TY = MT @TAB IGR`}</pre>
            </div>

            <div className="pt-3 border-t border-accent/20">
              <p className="text-[11px] text-muted-foreground leading-relaxed flex items-start gap-1.5">
                <CheckCircle2 size={11} className="text-emerald-600 mt-0.5 flex-shrink-0" />
                Les numéros (10, 15, 20…) ordonnent l'exécution. Laissez des trous pour insérer plus tard.
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed flex items-start gap-1.5 mt-1.5">
                <AlertTriangle size={11} className="text-amber-600 mt-0.5 flex-shrink-0" />
                Le label <code>FIN</code> est la cible standard de fin de règle.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Panneau de simulation (sandbox) */}
      <SimulationPanel
        open={simOpen}
        onClose={() => setSimOpen(false)}
        regleLibelle={form.libelle || form.code}
        lignes={
          mode === "TABLEUR"
            ? visibleInstr.map((i) => ({ numero: i.numero, instruction: i.instruction, label: i.label }))
            : form.instructions_text
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean)
                .map((l, idx) => {
                  const m = l.match(/^(\d+)\s+(.+)$/);
                  let numero = (idx + 1) * 10;
                  let body = l;
                  if (m) { numero = parseInt(m[1], 10); body = m[2]; }
                  let label: string | null = null;
                  const cIdx = body.indexOf(";");
                  if (cIdx >= 0) body = body.slice(0, cIdx).trim();
                  const lblMatch = body.match(/\s:(\w+)\s*$/);
                  if (lblMatch) {
                    label = lblMatch[1];
                    body = body.replace(/\s:\w+\s*$/, "").trim();
                  }
                  return { numero, instruction: body, label };
                })
        }
      />
    </div>
  );
};

export default RegleSpecifiqueForm;
