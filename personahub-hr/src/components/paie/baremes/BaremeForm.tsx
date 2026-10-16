/**
 * BaremeForm — formulaire de création/édition de barème.
 *
 * Reproduit l'écran cible :
 *   - En-tête : code, libellé, description, dates de validité, référence décision, actif
 *   - Clés d'entrée : N clés avec nom_technique, libellé, type, mode (EXACT/PLAGE)
 *   - Sorties : N sorties avec nom_technique, libellé, type, par_defaut
 *   - Lignes : tableau dynamique généré d'après l'en-tête
 *
 * Le mode PLAGE d'une clé scinde sa colonne en 2 sous-colonnes (min / max).
 */
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Save, Star, Trash2, ChevronDown, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

import { useBareme, useBaremeMutations } from "@/hooks/useBaremes";
import { useFormatMasks } from "@/hooks/useFormatMasks";
import FormattedInput from "@/components/paie/FormattedInput";
import {
  emptyBareme,
  MODE_CLE_OPTIONS,
  TYPE_CLE_OPTIONS,
  TYPE_SORTIE_OPTIONS,
  type BaremeCle,
  type BaremeLigne,
  type BaremePayload,
  type BaremeSortie,
  type ModeCle,
  type TypeCle,
  type TypeSortie,
} from "@/types/bareme";

// ---------------------------------------------------------------------------
// RG-BAR-MODE-01 (Adil DAIA) : les modes de comparaison étendus (LT/LTE/GT/GTE)
// sont désormais portés nativement par le type partagé ModeCle/MODE_CLE_OPTIONS
// (@/types/bareme) et interprétés par le backend — plus besoin du workaround
// local qui existait ici auparavant (anciens noms : ModeCleExt/MODE_CLE_OPTIONS_EXT).
// Toutes ces valeurs, comme PLAGE, ne sont proposées que pour les clés de
// type NUMERIQUE ou DATE (valeurs ordonnables) — cf. `disabled` du Select.
// ---------------------------------------------------------------------------
// Badge court affiché en en-tête des colonnes de la table Lignes,
// pour repérer visuellement le mode d'une clé sans survoler le select.
const MODE_BADGE: Partial<Record<ModeCle, string>> = {
  PLAGE: "PLAGE", LT: "< x", LTE: "≤ x", GT: "> x", GTE: "≥ x",
};

interface Props {
  baremeId?: string; // si fourni → mode édition
}

export function BaremeForm({ baremeId }: Props) {
  const navigate = useNavigate();
  const isEdit = !!baremeId;
  const { data: existing, isLoading } = useBareme(baremeId);

  // RG-BAR-ACC-01 (Adil DAIA) : Pavés repliables individuellement
  const [openSections, setOpenSections] = useState({
    entete: true, cles: true, sorties: true, lignes: true,
  });
  const toggleSection = (k: keyof typeof openSections) =>
    setOpenSections(s => ({ ...s, [k]: !s[k] }));

  // RG-BAR-FMT-01 (Adil DAIA) : Hook de formatage selon les masques d'affichage
  const { formatNumber: fmtNum, formatDate: fmtDate } = useFormatMasks();
  const { create, replace } = useBaremeMutations();

  const [form, setForm] = useState<BaremePayload>(emptyBareme());
  const [errors, setErrors] = useState<string[]>([]);

  // Pré-remplit en mode édition
  useEffect(() => {
    if (existing) {
      setForm({
        code: existing.code,
        libelle: existing.libelle,
        description: existing.description,
        date_debut_validite: existing.date_debut_validite,
        date_fin_validite: existing.date_fin_validite,
        reference_decision: existing.reference_decision,
        actif: existing.actif,
        cles: existing.cles,
        sorties: existing.sorties,
        lignes: existing.lignes,
      });
    }
  }, [existing]);

  // ---------------------------------------------------------------------
  // Handlers en-tête
  // ---------------------------------------------------------------------
  const updateHeader = <K extends keyof BaremePayload>(key: K, value: BaremePayload[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // ---------------------------------------------------------------------
  // Handlers clés
  // ---------------------------------------------------------------------
  const addCle = () =>
    setForm((f) => ({
      ...f,
      cles: [
        ...f.cles,
        {
          nom_technique: `cle${f.cles.length + 1}`,
          libelle: `Clé ${f.cles.length + 1}`,
          type: "NUMERIQUE",
          mode: "EXACT",
          ordre: f.cles.length,
        },
      ],
    }));

  const updateCle = (idx: number, patch: Partial<BaremeCle>) =>
    setForm((f) => ({
      ...f,
      cles: f.cles.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    }));

  const removeCle = (idx: number) =>
    setForm((f) => {
      const cleSupprimee = f.cles[idx];
      return {
        ...f,
        cles: f.cles.filter((_, i) => i !== idx),
        // Nettoie les valeurs des lignes pour cette clé supprimée
        lignes: f.lignes.map((l) => {
          const { [cleSupprimee.nom_technique]: _drop, ...rest } = l.valeurs_cles;
          return { ...l, valeurs_cles: rest };
        }),
      };
    });

  // ---------------------------------------------------------------------
  // Handlers sorties
  // ---------------------------------------------------------------------
  const addSortie = () =>
    setForm((f) => ({
      ...f,
      sorties: [
        ...f.sorties,
        {
          nom_technique: `sortie${f.sorties.length + 1}`,
          libelle: `Sortie ${f.sorties.length + 1}`,
          type: "MONTANT",
          par_defaut: f.sorties.length === 0,
          ordre: f.sorties.length,
        },
      ],
    }));

  const updateSortie = (idx: number, patch: Partial<BaremeSortie>) =>
    setForm((f) => {
      let sorties = f.sorties.map((s, i) => (i === idx ? { ...s, ...patch } : s));
      // Si on vient de marquer celle-ci par_defaut, on retire le flag des autres
      if (patch.par_defaut) {
        sorties = sorties.map((s, i) => ({ ...s, par_defaut: i === idx }));
      }
      return { ...f, sorties };
    });

  const removeSortie = (idx: number) =>
    setForm((f) => {
      const sortieSupprimee = f.sorties[idx];
      const sorties = f.sorties.filter((_, i) => i !== idx);
      // Si on supprime celle par défaut, on promeut la première restante
      if (sortieSupprimee.par_defaut && sorties.length > 0 && !sorties.some((s) => s.par_defaut)) {
        sorties[0] = { ...sorties[0], par_defaut: true };
      }
      return {
        ...f,
        sorties,
        lignes: f.lignes.map((l) => {
          const { [sortieSupprimee.nom_technique]: _drop, ...rest } = l.valeurs_sorties;
          return { ...l, valeurs_sorties: rest };
        }),
      };
    });

  // ---------------------------------------------------------------------
  // Handlers lignes
  // ---------------------------------------------------------------------
  const addLigne = () =>
    setForm((f) => ({
      ...f,
      lignes: [
        ...f.lignes,
        {
          ordre: f.lignes.length,
          valeurs_cles: Object.fromEntries(
            f.cles.map((c) => [c.nom_technique, c.mode === "PLAGE" ? { min: 0, max: 0 } : ""]),
          ),
          valeurs_sorties: Object.fromEntries(f.sorties.map((s) => [s.nom_technique, ""])),
          commentaire: null,
        },
      ],
    }));

  const updateLigneCleEx = (rowIdx: number, nomCle: string, val: string | number | boolean) =>
    setForm((f) => ({
      ...f,
      lignes: f.lignes.map((l, i) =>
        i === rowIdx ? { ...l, valeurs_cles: { ...l.valeurs_cles, [nomCle]: val } } : l,
      ),
    }));

  const updateLigneCleRange = (rowIdx: number, nomCle: string, side: "min" | "max", val: number) =>
    setForm((f) => ({
      ...f,
      lignes: f.lignes.map((l, i) => {
        if (i !== rowIdx) return l;
        const current = l.valeurs_cles[nomCle];
        const range = typeof current === "object" && current !== null ? current : { min: 0, max: 0 };
        return {
          ...l,
          valeurs_cles: {
            ...l.valeurs_cles,
            [nomCle]: { ...range, [side]: val },
          },
        };
      }),
    }));

  const updateLigneSortie = (rowIdx: number, nomSortie: string, val: string | number | boolean) =>
    setForm((f) => ({
      ...f,
      lignes: f.lignes.map((l, i) =>
        i === rowIdx
          ? { ...l, valeurs_sorties: { ...l.valeurs_sorties, [nomSortie]: val } }
          : l,
      ),
    }));

  const updateLigneCommentaire = (rowIdx: number, val: string) =>
    setForm((f) => ({
      ...f,
      lignes: f.lignes.map((l, i) => (i === rowIdx ? { ...l, commentaire: val || null } : l)),
    }));

  const removeLigne = (rowIdx: number) =>
    setForm((f) => ({
      ...f,
      lignes: f.lignes.filter((_, i) => i !== rowIdx),
    }));

  // ---------------------------------------------------------------------
  // Validation locale et sauvegarde
  // ---------------------------------------------------------------------
  const validate = (): string[] => {
    const errs: string[] = [];
    if (!form.code) errs.push("Le code est obligatoire");
    if (!form.libelle) errs.push("Le libellé est obligatoire");
    if (!form.date_debut_validite) errs.push("La date de début de validité est obligatoire");
    if (form.cles.length === 0) errs.push("Au moins une clé d'entrée est requise");
    if (form.sorties.length === 0) errs.push("Au moins une sortie est requise");
    if (!form.sorties.some((s) => s.par_defaut))
      errs.push("Une sortie doit être marquée par défaut");

    const cleNoms = form.cles.map((c) => c.nom_technique);
    if (new Set(cleNoms).size !== cleNoms.length)
      errs.push("Les noms techniques des clés doivent être uniques");

    const sortieNoms = form.sorties.map((s) => s.nom_technique);
    if (new Set(sortieNoms).size !== sortieNoms.length)
      errs.push("Les noms techniques des sorties doivent être uniques");

    return errs;
  };

  const handleSave = async () => {
    const errs = validate();
    setErrors(errs);
    if (errs.length > 0) return;

    if (isEdit && baremeId) {
      await replace.mutateAsync({ id: baremeId, payload: form });
    } else {
      const created = await create.mutateAsync(form);
      navigate(`/paie/parametrage/baremes/${created.id}`);
    }
  };

  const sortieDefaut = useMemo(() => form.sorties.find((s) => s.par_defaut), [form.sorties]);

  if (isEdit && isLoading) {
    return <div className="p-6 text-muted-foreground">Chargement…</div>;
  }

  // ---------------------------------------------------------------------
  // Rendu
  // ---------------------------------------------------------------------
  return (
    <div className="space-y-5 p-6 text-sm
      [&_table_th]:h-8 [&_table_th]:py-1.5 [&_table_th]:text-xs
      [&_table_td]:py-1 [&_table_td]:align-middle
      [&_tbody_tr]:border-b [&_tbody_tr:last-child]:border-0
      [&_tbody_tr:hover]:bg-muted/40
      [&_tbody_tr:nth-child(even)]:bg-muted/15
      [&_input]:h-8 [&_input]:text-sm
      [&_textarea]:text-sm
      [&_[role=combobox]]:h-8 [&_[role=combobox]]:text-sm
    ">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Retour
        </Button>
        <Button onClick={handleSave} disabled={create.isPending || replace.isPending}>
          <Save className="mr-2 h-4 w-4" />
          {isEdit ? "Enregistrer" : "Créer"}
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {isEdit ? "Modifier barème" : "Nouveau barème"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Définissez l'en-tête, les <strong>clés d'entrée</strong> (mode{" "}
          <code className="text-xs bg-muted px-1 rounded">EXACT</code>,{" "}
          <code className="text-xs bg-muted px-1 rounded">PLAGE</code> ou comparaison{" "}
          <code className="text-xs bg-muted px-1 rounded">&lt; ≤ &gt; ≥</code>), les{" "}
          <strong>sorties</strong> (une sortie par défaut, accessible par{" "}
          <code className="text-xs bg-muted px-1 rounded">@TAB CODE</code>), puis les lignes.
        </p>
      </div>

      {errors.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <ul className="list-disc pl-5">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ───────────────────────────── EN-TÊTE ───────────────────────────── */}
      <section className="rounded-lg border bg-card overflow-hidden">
        <button type="button" onClick={() => toggleSection("entete")}
          className="w-full flex items-center gap-2 px-4 py-2 hover:bg-muted/30 transition-colors">
          {openSections.entete ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <h2 className="font-semibold">En-tête</h2>
        </button>
        {openSections.entete && (
        <div className="px-4 pb-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="code">Code *</Label>
            <Input
              id="code"
              value={form.code}
              onChange={(e) => updateHeader("code", e.target.value.toUpperCase())}
              placeholder="Ex: PANC"
            />
          </div>
          <div>
            <Label htmlFor="libelle">Libellé *</Label>
            <Input
              id="libelle"
              value={form.libelle}
              onChange={(e) => updateHeader("libelle", e.target.value)}
              placeholder="Ex: Barème des Anciennetés"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            rows={2}
            value={form.description ?? ""}
            onChange={(e) => updateHeader("description", e.target.value || null)}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="date_debut">Date début validité *</Label>
            <Input
              id="date_debut"
              type="date"
              value={form.date_debut_validite}
              onChange={(e) => updateHeader("date_debut_validite", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="date_fin">Date fin validité</Label>
            <Input
              id="date_fin"
              type="date"
              value={form.date_fin_validite ?? ""}
              onChange={(e) => updateHeader("date_fin_validite", e.target.value || null)}
            />
          </div>
          <div>
            <Label htmlFor="ref_decision">Référence décision</Label>
            <Input
              id="ref_decision"
              value={form.reference_decision ?? ""}
              onChange={(e) => updateHeader("reference_decision", e.target.value || null)}
            />
          </div>
        </div>
        <div className="flex items-center gap-3 pt-1">
          <Switch
            id="actif"
            checked={form.actif}
            onCheckedChange={(v) => updateHeader("actif", v)}
          />
          <Label htmlFor="actif">Barème actif</Label>
        </div>
        </div>
        )}
      </section>

      {/* ───────────────────────────── CLÉS ───────────────────────────── */}
      <section className="rounded-lg border bg-card overflow-hidden">
        <div className="w-full flex items-center justify-between gap-2 px-4 py-2 hover:bg-muted/30 transition-colors">
          <button type="button" onClick={() => toggleSection("cles")} className="flex items-center gap-2 flex-1 text-left">
            {openSections.cles ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <div>
              <h2 className="font-semibold">Clés d'entrée ({form.cles.length})</h2>
              <p className="text-xs text-muted-foreground">
                Critères utilisés pour rechercher la ligne correspondante. Mode{" "}
                <strong>EXACT</strong> = égalité ; <strong>PLAGE</strong> = entre min et max ;{" "}
                <strong>&lt;</strong>, <strong>≤</strong>, <strong>&gt;</strong>, <strong>≥</strong> = comparaison stricte ou non à une valeur unique.
              </p>
            </div>
          </button>
          <Button size="sm" variant="outline" onClick={addCle}>
            <Plus className="mr-1 h-4 w-4" /> Clé
          </Button>
        </div>
        {openSections.cles && (
        <div className="px-4 pb-4 space-y-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Nom (technique)</TableHead>
              <TableHead>Libellé</TableHead>
              <TableHead className="w-40">Type</TableHead>
              <TableHead className="w-40">Mode</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {form.cles.map((c, i) => (
              <TableRow key={i}>
                <TableCell>{i + 1}</TableCell>
                <TableCell>
                  <Input
                    value={c.nom_technique}
                    onChange={(e) =>
                      updateCle(i, { nom_technique: e.target.value.toLowerCase().replace(/\s/g, "_") })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Input value={c.libelle} onChange={(e) => updateCle(i, { libelle: e.target.value })} />
                </TableCell>
                <TableCell>
                  <Select
                    value={c.type}
                    onValueChange={(v) => {
                      const newType = v as TypeCle;
                      const patch: Partial<BaremeCle> = { type: newType };
                      // Si on passe à un type incompatible avec PLAGE, on force EXACT
                      if (c.mode === "PLAGE" && newType !== "NUMERIQUE" && newType !== "DATE") {
                        patch.mode = "EXACT";
                      }
                      updateCle(i, patch);
                    }}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPE_CLE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Select
                    value={c.mode}
                    onValueChange={(v) => updateCle(i, { mode: v as ModeCle })}
                    disabled={c.type !== "NUMERIQUE" && c.type !== "DATE"}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MODE_CLE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon" className="h-7 w-7"
                    onClick={() => removeCle(i)}
                    disabled={form.cles.length === 1}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
        )}
      </section>

      {/* ───────────────────────────── SORTIES ───────────────────────────── */}
      <section className="rounded-lg border bg-card overflow-hidden">
        <div className="w-full flex items-center justify-between gap-2 px-4 py-2 hover:bg-muted/30 transition-colors">
          <button type="button" onClick={() => toggleSection("sorties")} className="flex items-center gap-2 flex-1 text-left">
            {openSections.sorties ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <div>
            <h2 className="font-semibold">Sorties ({form.sorties.length})</h2>
            <p className="text-xs text-muted-foreground">
              Valeurs renvoyées par le barème. La sortie « par défaut » est utilisée par{" "}
              <code className="text-xs bg-muted px-1 rounded">@TAB CODE</code>. Les autres sont
              accessibles par <code className="text-xs bg-muted px-1 rounded">@TAB CODE.nom</code>.
            </p>
          </div>
          </button>
          <Button size="sm" variant="outline" onClick={addSortie}>
            <Plus className="mr-1 h-4 w-4" /> Sortie
          </Button>
        </div>
        {openSections.sorties && (
        <div className="px-4 pb-4 space-y-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Nom (technique)</TableHead>
              <TableHead>Libellé</TableHead>
              <TableHead className="w-40">Type</TableHead>
              <TableHead className="w-24 text-center">Par défaut</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {form.sorties.map((s, i) => (
              <TableRow key={i}>
                <TableCell>{i + 1}</TableCell>
                <TableCell>
                  <Input
                    value={s.nom_technique}
                    onChange={(e) =>
                      updateSortie(i, {
                        nom_technique: e.target.value.toLowerCase().replace(/\s/g, "_"),
                      })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={s.libelle}
                    onChange={(e) => updateSortie(i, { libelle: e.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={s.type}
                    onValueChange={(v) => updateSortie(i, { type: v as TypeSortie })}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPE_SORTIE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-center">
                  <Button
                    variant={s.par_defaut ? "default" : "ghost"}
                    size="icon" className="h-7 w-7"
                    onClick={() => updateSortie(i, { par_defaut: true })}
                    title="Marquer comme sortie par défaut"
                  >
                    <Star className={s.par_defaut ? "h-4 w-4 fill-current" : "h-4 w-4"} />
                  </Button>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon" className="h-7 w-7"
                    onClick={() => removeSortie(i)}
                    disabled={form.sorties.length === 1}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
        )}
      </section>

      {/* ───────────────────────────── LIGNES ───────────────────────────── */}
      <section className="rounded-lg border bg-card overflow-hidden">
        <div className="w-full flex items-center justify-between gap-2 px-4 py-2 hover:bg-muted/30 transition-colors">
          <button type="button" onClick={() => toggleSection("lignes")} className="flex items-center gap-2 flex-1 text-left">
            {openSections.lignes ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <div>
              <h2 className="font-semibold">Lignes du barème ({form.lignes.length})</h2>
              <p className="text-xs text-muted-foreground">
                Les colonnes ci-dessous sont générées automatiquement d'après les clés et sorties définies plus haut.
              </p>
            </div>
          </button>
          <Button size="sm" variant="outline" onClick={addLigne}>
            <Plus className="mr-1 h-4 w-4" /> Ligne
          </Button>
        </div>
        {openSections.lignes && (
        <div className="px-4 pb-4 space-y-3">

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                {form.cles.map((c) =>
                  c.mode === "PLAGE" ? (
                    <TableHead key={c.nom_technique} colSpan={2} className="text-center">
                      {c.libelle.toUpperCase()}
                      <Badge variant="secondary" className="ml-2 text-[10px]">PLAGE</Badge>
                    </TableHead>
                  ) : (
                    <TableHead key={c.nom_technique}>
                      {c.libelle.toUpperCase()}
                      {MODE_BADGE[c.mode as ModeCle] && (
                        <Badge variant="secondary" className="ml-2 text-[10px]">{MODE_BADGE[c.mode as ModeCle]}</Badge>
                      )}
                    </TableHead>
                  ),
                )}
                {form.sorties.map((s) => (
                  <TableHead key={s.nom_technique}>
                    {s.libelle.toUpperCase()}
                    {s.par_defaut && <Star className="inline h-3 w-3 ml-1 fill-current" />}
                  </TableHead>
                ))}
                <TableHead>Commentaire</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
              {/* Sous-en-tête min/max pour les colonnes PLAGE */}
              {form.cles.some((c) => c.mode === "PLAGE") && (
                <TableRow>
                  <TableHead></TableHead>
                  {form.cles.map((c) =>
                    c.mode === "PLAGE" ? (
                      <React.Fragment key={c.nom_technique + "_minmax"}>
                        <TableHead key={c.nom_technique + "_min"} className="text-xs">Min</TableHead>
                        <TableHead key={c.nom_technique + "_max"} className="text-xs">Max</TableHead>
                      </React.Fragment>
                    ) : (
                      <TableHead key={c.nom_technique + "_pad"}></TableHead>
                    ),
                  )}
                  {form.sorties.map((s) => (
                    <TableHead key={s.nom_technique + "_pad"}></TableHead>
                  ))}
                  <TableHead></TableHead>
                  <TableHead></TableHead>
                </TableRow>
              )}
            </TableHeader>
            <TableBody>
              {form.lignes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={20} className="text-center text-muted-foreground py-6">
                    Aucune ligne. <button className="underline" onClick={addLigne}>Ajouter la première</button>
                  </TableCell>
                </TableRow>
              ) : (
                form.lignes.map((ligne, rowIdx) => (
                  <TableRow key={rowIdx}>
                    <TableCell>{rowIdx + 1}</TableCell>
                    {form.cles.map((c) => {
                      const val = ligne.valeurs_cles[c.nom_technique];
                      if (c.mode === "PLAGE") {
                        const range =
                          typeof val === "object" && val !== null
                            ? (val as { min: number; max: number })
                            : { min: 0, max: 0 };
                        return (
                          <React.Fragment key={c.nom_technique}>
                            <TableCell key={c.nom_technique + "_min"}>
                              <FormattedInput
                                type={c.type === "DATE" ? "date" : "number"}
                                value={range.min}
                                onChange={(v) =>
                                  updateLigneCleRange(rowIdx, c.nom_technique, "min", typeof v === "number" ? v : Number(v) || 0)
                                }
                              />
                            </TableCell>
                            <TableCell key={c.nom_technique + "_max"}>
                              <FormattedInput
                                type={c.type === "DATE" ? "date" : "number"}
                                value={range.max}
                                onChange={(v) =>
                                  updateLigneCleRange(rowIdx, c.nom_technique, "max", typeof v === "number" ? v : Number(v) || 0)
                                }
                              />
                            </TableCell>
                          </React.Fragment>
                        );
                      }
                      return (
                        <TableCell key={c.nom_technique}>
                          <FormattedInput
                            type={
                              c.type === "NUMERIQUE" ? "number"
                              : c.type === "DATE" ? "date"
                              : c.type === "BOOLEEN" ? "boolean"
                              : "text"
                            }
                            value={
                              typeof val === "object" || val === undefined || val === null
                                ? (c.type === "BOOLEEN" ? false : "")
                                : (val as any)
                            }
                            onChange={(v) => updateLigneCleEx(rowIdx, c.nom_technique, v as any)}
                          />
                        </TableCell>
                      );
                    })}
                    {form.sorties.map((s) => (
                      <TableCell key={s.nom_technique}>
                        <FormattedInput
                          type={
                            s.type === "TAUX" ? "percent"
                            : s.type === "MONTANT" ? "currency"
                            : s.type === "NUMERIQUE" ? "number"
                            : s.type === "BOOLEEN" ? "boolean"
                            : "text"
                          }
                          decimales={s.type === "TAUX" ? 4 : 2}
                          value={
                            ligne.valeurs_sorties[s.nom_technique] === null ||
                            ligne.valeurs_sorties[s.nom_technique] === undefined
                              ? (s.type === "BOOLEEN" ? false : "")
                              : (ligne.valeurs_sorties[s.nom_technique] as any)
                          }
                          onChange={(v) => updateLigneSortie(rowIdx, s.nom_technique, v as any)}
                        />
                      </TableCell>
                    ))}
                    <TableCell>
                      <Input
                        value={ligne.commentaire ?? ""}
                        onChange={(e) => updateLigneCommentaire(rowIdx, e.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeLigne(rowIdx)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {sortieDefaut && form.code && (
          <p className="text-xs text-muted-foreground pt-2">
            ℹ️ Usage dans une règle :{" "}
            <code className="bg-muted px-1 rounded">
              VALEUR @TAB {form.code} (sortie par défaut <strong>{sortieDefaut.nom_technique}</strong>)
            </code>
          </p>
        )}
              </div>
        )}
      </section>
    </div>
  );
}
