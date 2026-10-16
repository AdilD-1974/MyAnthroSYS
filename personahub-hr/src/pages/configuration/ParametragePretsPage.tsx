// src/pages/configuration/ParametragePretsPage.tsx
//
// Paramétrage du module Prêts & Avances : catégories, types de prêt, règles
// d'éligibilité dynamiques. Style aligné sur MesPretsPage.tsx/GestionPretsPage.tsx
// (bordures fines, hsl(var(--primary)), var(--radius), badges colorés) — donc
// respecte automatiquement le thème choisi par l'utilisateur dans AppearancePage.
import React, { useEffect, useMemo, useState, useCallback } from "react";
import * as LucideIcons from "lucide-react";
import {
  Plus, Pencil, Copy, Archive, ArchiveRestore, ArrowUp, ArrowDown, ArrowUpDown, Settings2, Trash2, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { db } from "@/lib/api";
import {
  pretsApi, CategoriePret, TypePretAdmin, RegleCatalogue, TypeRegle,
  AlgoAmortissement, ALGO_LABELS,
} from "@/lib/pretsApi";

// ──────────────────────────────────────────────────────────────
// TRI GÉNÉRIQUE — même hook réutilisé par Catégories et Types
// ──────────────────────────────────────────────────────────────

function useSort<T extends Record<string, any>>(items: T[], defaultKey: keyof T) {
  const [sortKey, setSortKey] = useState<keyof T>(defaultKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
      const cmp = String(av).localeCompare(String(bv), "fr");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [items, sortKey, sortDir]);

  const toggleSort = (key: keyof T) => {
    if (key === sortKey) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  return { sorted, sortKey, sortDir, toggleSort };
}

const SortableTh: React.FC<{
  label: string; sortKey: string; activeKey: string; dir: "asc" | "desc"; onSort: (k: string) => void; className?: string;
}> = ({ label, sortKey, activeKey, dir, onSort, className }) => (
  <th
    className={`px-3 py-2 text-left font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground ${className ?? ""}`}
    onClick={() => onSort(sortKey)}
  >
    <span className="inline-flex items-center gap-1">
      {label}
      {activeKey === sortKey
        ? (dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)
        : <ArrowUpDown size={11} className="opacity-30" />}
    </span>
  </th>
);

const DynIcon: React.FC<{ name?: string; size?: number; color?: string }> = ({ name = "Tag", size = 16, color }) => {
  const Icon = (LucideIcons as Record<string, any>)[name];
  return Icon ? <Icon size={size} color={color} /> : <LucideIcons.Tag size={size} color={color} />;
};

const ActifBadge: React.FC<{ actif: boolean }> = ({ actif }) => (
  <span
    className="px-2 py-0.5 rounded-full text-[11px] font-medium"
    style={actif
      ? { background: "hsl(var(--success) / 0.12)", color: "hsl(var(--success))" }
      : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}
  >
    {actif ? "Actif" : "Inactif"}
  </span>
);

// ──────────────────────────────────────────────────────────────
// CATÉGORIES
// ──────────────────────────────────────────────────────────────

const CATEGORIE_VIDE: CategoriePret = { code: "", libelle: "", description: "", icone: "Tag", couleur: "#6b7280", ordre: 10, actif: true };

const CategorieFormDialog: React.FC<{
  initial: CategoriePret | null; verrouillerCode: boolean; onClose: () => void; onSaved: () => void;
}> = ({ initial, verrouillerCode, onClose, onSaved }) => {
  const [form, setForm] = useState<CategoriePret>(initial ?? CATEGORIE_VIDE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enregistrer = async () => {
    setSaving(true);
    setError(null);
    try {
      if (verrouillerCode) await pretsApi.modifierCategorie(form.code, form);
      else await pretsApi.creerCategorie(form);
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">
            {verrouillerCode ? "Modifier la catégorie" : initial ? "Dupliquer la catégorie" : "Nouvelle catégorie"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1 block">Code</Label>
              <Input value={form.code} disabled={verrouillerCode} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="SOCIAL" />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Ordre d'affichage</Label>
              <Input type="number" value={form.ordre} onChange={e => setForm({ ...form, ordre: Number(e.target.value) })} />
            </div>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Libellé</Label>
            <Input value={form.libelle} onChange={e => setForm({ ...form, libelle: e.target.value })} placeholder="Prêt social" />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Description</Label>
            <Textarea rows={2} value={form.description ?? ""} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1 block">Icône (lucide-react)</Label>
              <div className="flex items-center gap-2">
                <Input value={form.icone} onChange={e => setForm({ ...form, icone: e.target.value })} placeholder="Tag" />
                <DynIcon name={form.icone} color={form.couleur} />
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Couleur</Label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.couleur} onChange={e => setForm({ ...form, couleur: e.target.value })} className="h-9 w-12 rounded border border-border" />
                <Input value={form.couleur} onChange={e => setForm({ ...form, couleur: e.target.value })} />
              </div>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.actif} onChange={e => setForm({ ...form, actif: e.target.checked })} />
            Catégorie active
          </label>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={enregistrer} disabled={saving || !form.code || !form.libelle}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

type EditionCategorie = { mode: "nouvelle" } | { mode: "edition"; data: CategoriePret } | { mode: "duplication"; data: CategoriePret } | null;

const CategoriesTab: React.FC = () => {
  const [categories, setCategories] = useState<CategoriePret[]>([]);
  const [loading, setLoading] = useState(true);
  const [edition, setEdition] = useState<EditionCategorie>(null);
  const [afficherArchives, setAfficherArchives] = useState(false);

  const charger = useCallback(async () => {
    setLoading(true);
    try { setCategories(await pretsApi.listerCategories()); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const visibles = afficherArchives ? categories : categories.filter(c => c.actif);
  const { sorted, sortKey, sortDir, toggleSort } = useSort<CategoriePret>(visibles, "ordre");

  const basculerActif = async (c: CategoriePret) => {
    await pretsApi.modifierCategorie(c.code, { ...c, actif: !c.actif });
    charger();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={afficherArchives} onChange={e => setAfficherArchives(e.target.checked)} />
          Afficher les catégories archivées
        </label>
        <Button size="sm" onClick={() => setEdition({ mode: "nouvelle" })}>
          <Plus size={14} className="mr-1.5" /> Nouvelle catégorie
        </Button>
      </div>
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs">
            <tr className="border-b border-border">
              <th className="px-3 py-2 w-10"></th>
              <SortableTh label="Code" sortKey="code" activeKey={sortKey as string} dir={sortDir} onSort={k => toggleSort(k as keyof CategoriePret)} />
              <SortableTh label="Libellé" sortKey="libelle" activeKey={sortKey as string} dir={sortDir} onSort={k => toggleSort(k as keyof CategoriePret)} />
              <SortableTh label="Ordre" sortKey="ordre" activeKey={sortKey as string} dir={sortDir} onSort={k => toggleSort(k as keyof CategoriePret)} />
              <SortableTh label="Statut" sortKey="actif" activeKey={sortKey as string} dir={sortDir} onSort={k => toggleSort(k as keyof CategoriePret)} />
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-8 text-sm text-muted-foreground">Chargement…</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-sm text-muted-foreground">Aucune catégorie.</td></tr>
            ) : sorted.map(c => (
              <tr key={c.code} className={`border-t border-border hover:bg-secondary/20 ${!c.actif ? "opacity-60" : ""}`}>
                <td className="px-3 py-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: c.couleur + "20" }}>
                    <DynIcon name={c.icone} size={14} color={c.couleur} />
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{c.code}</td>
                <td className="px-3 py-2 font-medium">{c.libelle}</td>
                <td className="px-3 py-2 text-muted-foreground">{c.ordre}</td>
                <td className="px-3 py-2"><ActifBadge actif={c.actif} /></td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-[hsl(var(--primary))]" title="Modifier" onClick={() => setEdition({ mode: "edition", data: c })}>
                      <Pencil size={13} />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-[hsl(var(--primary))]" title="Dupliquer"
                      onClick={() => setEdition({ mode: "duplication", data: { ...c, code: "" } })}>
                      <Copy size={13} />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-[hsl(var(--warning))]" title={c.actif ? "Archiver" : "Désarchiver"} onClick={() => basculerActif(c)}>
                      {c.actif ? <Archive size={13} /> : <ArchiveRestore size={13} />}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edition && (
        <CategorieFormDialog
          initial={edition.mode === "nouvelle" ? null : edition.data}
          verrouillerCode={edition.mode === "edition"}
          onClose={() => setEdition(null)}
          onSaved={() => { setEdition(null); charger(); }}
        />
      )}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// TYPES DE PRÊT
// ──────────────────────────────────────────────────────────────

const TYPE_VIDE: TypePretAdmin = {
  code: "", libelle: "", description: "", categorie_code: "", origine_code: "",
  taux_annuel_defaut: 0, duree_max_mois: 36, montant_max: null, anciennete_min_mois: 6,
  algo_defaut: "lineaire", rubrique_paie_code: "", rubrique_paie_lib: "",
  rubrique_paie_code_interet: "", rubrique_paie_lib_interet: "",
  rubrique_paie_code_tva: "", rubrique_paie_lib_tva: "",
  imputable_paie: true, nb_max_simultanes: 1, renouvelable: false, justificatif_requis: false,
  double_validation: false, avance_sur_salaire: false, workflow_actif: true, code_workflow: "",
  autorise_remboursement_anticipe: true, autorise_suspension: true, report_max_consecutif: 1,
  mode_amortissement_defaut: "AUTO", priorite_retenue: 40, quotite_max_pourcent_override: null,
  types_contrat_autorises: null, icone: "Banknote", couleur: "#0ea5e9", ordre: 10, actif: true,
};

// ──────────────────────────────────────────────────────────────
// AUTOCOMPLETE RUBRIQUES — famille "Retenue", non déjà affectées
// (interroge directement /db/rubrique_paie et /db/ref_famille_rubrique_paie,
// aucun nouvel endpoint backend nécessaire)
// ──────────────────────────────────────────────────────────────

interface RubriqueOption { code: string; libelle: string }

const RubriqueAutocomplete: React.FC<{
  value: string; disponibles: RubriqueOption[]; onChange: (code: string, libelle?: string) => void; placeholder?: string;
}> = ({ value, disponibles, onChange, placeholder }) => {
  const [query, setQuery] = useState(value);
  const [ouvert, setOuvert] = useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  useEffect(() => { setQuery(value); }, [value]);

  const filtrees = disponibles.filter(r =>
    !query || r.code.toLowerCase().includes(query.toLowerCase()) || r.libelle.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 50);

  const resolue = disponibles.find(r => r.code === query);

  return (
    <div className="relative">
      <div className="relative">
        <Input
          ref={inputRef}
          value={query}
          onChange={e => { const v = e.target.value; setQuery(v); onChange(v.toUpperCase()); setOuvert(true); }}
          onFocus={() => setOuvert(true)}
          onBlur={() => setTimeout(() => setOuvert(false), 150)}
          placeholder={placeholder}
          className="pr-8"
        />
        <button
          type="button"
          tabIndex={-1}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onMouseDown={e => { e.preventDefault(); setOuvert(o => !o); inputRef.current?.focus(); }}
        >
          <ChevronDown size={14} />
        </button>
      </div>
      {ouvert && filtrees.length > 0 && (
        <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          {filtrees.map(r => (
            <button
              key={r.code} type="button"
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-secondary/50 block"
              onMouseDown={() => { onChange(r.code, r.libelle); setQuery(r.code); setOuvert(false); }}
            >
              <span className="font-mono">{r.code}</span> — {r.libelle}
            </button>
          ))}
        </div>
      )}
      {ouvert && query && filtrees.length === 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-popover shadow-md px-3 py-2 text-xs text-muted-foreground">
          Aucune rubrique ne correspond à "{query}".
        </div>
      )}
      {resolue ? (
        <p className="text-[11px] mt-1 font-medium" style={{ color: "hsl(var(--primary))" }}>
          {resolue.libelle} ({resolue.code})
        </p>
      ) : query && (
        <p className="text-[11px] mt-1" style={{ color: "hsl(var(--warning))" }}>
          Aucune rubrique disponible ne correspond exactement à ce code — vérifiez qu'elle existe et
          appartient à la bonne famille.
        </p>
      )}
    </div>
  );
};

const TypeFormDialog: React.FC<{
  initial: TypePretAdmin | null; verrouillerCode: boolean; categories: CategoriePret[]; origines: { code: string; libelle: string }[];
  allTypes: TypePretAdmin[];
  onClose: () => void; onSaved: () => void;
}> = ({ initial, verrouillerCode, categories, origines, allTypes, onClose, onSaved }) => {
  const [form, setForm] = useState<TypePretAdmin>(initial ?? TYPE_VIDE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rubriquesRetenue, setRubriquesRetenue] = useState<RubriqueOption[]>([]);
  const [rubriquesInteret, setRubriquesInteret] = useState<RubriqueOption[]>([]);
  const [workflows, setWorkflows] = useState<{ code: string; libelle: string; type_objet: string }[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const wf = await db.list<{ code: string; libelle: string; type_objet: string }>("ref_workflow", {
          type_objet: "in.(generique,prets)", actif: true, select: "code,libelle,type_objet",
        });
        setWorkflows(wf);
      } catch {
        // Silencieux : le champ affichera "aucun processus disponible" plutôt que de bloquer le formulaire.
      }
    })();
  }, []);

  const [erreurRubriques, setErreurRubriques] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setErreurRubriques(null);
      try {
        const familles = await db.list<{ code: string; libelle: string }>("ref_famille_rubrique_paie", { actif: true, select: "code,libelle" });

        // Rubrique mensualité/capital : strictement famille "Retenues".
        const familleRetenue = familles.find(f => f.libelle.toLowerCase().includes("retenue"));
        if (familleRetenue) {
          const rubs = await db.list<{ code: string; libelle: string }>("rubrique_paie", {
            code_famille: familleRetenue.code, archive: false, select: "code,libelle",
          });
          setRubriquesRetenue(rubs);
        } else {
          setErreurRubriques("Aucune famille de rubrique contenant \"retenue\" trouvée dans ref_famille_rubrique_paie.");
        }

        // Rubrique intérêts/TVA : toute famille SAUF Cotisations (patronale
        // ou salariale) — pas de famille "Gain" dans ce système, seule
        // l'exclusion "cotisation" s'applique réellement ici.
        const famillesExclues = familles
          .filter(f => f.libelle.toLowerCase().includes("cotisation"))
          .map(f => f.code);

        const rubsInteret = await db.list<{ code: string; libelle: string }>("rubrique_paie", {
          archive: false,
          ...(famillesExclues.length ? { code_famille: `not.in.(${famillesExclues.join(",")})` } : {}),
          select: "code,libelle",
        });
        setRubriquesInteret(rubsInteret);
      } catch (e: any) {
        setErreurRubriques(e?.message ?? "Erreur lors du chargement du référentiel des rubriques.");
      }
    })();
  }, []);

  // Une même rubrique de paie peut être partagée par plusieurs types de
  // prêt (ex. plusieurs offres immobilières imputées sur la même ligne) —
  // aucune exclusion entre types ici.
  const rubriquesLibresPour = (_champActuel: string | null | undefined, pool: RubriqueOption[]) => pool;

  const estExterne = (form.origine_code ?? "").toUpperCase() === "EXTERNE";

  useEffect(() => {
    if (estExterne && form.workflow_actif) {
      setForm(f => ({ ...f, workflow_actif: false, code_workflow: "" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estExterne]);

  const set = <K extends keyof TypePretAdmin>(k: K, v: TypePretAdmin[K]) => setForm(f => ({ ...f, [k]: v }));

  const enregistrer = async () => {
    setSaving(true);
    setError(null);
    try {
      // code_workflow a une contrainte de clé étrangère vers ref_workflow —
      // une chaîne vide "" n'est PAS acceptée (seul NULL l'est). Idem pour
      // les rubriques TVA optionnelles, par cohérence.
      const payload = {
        ...form,
        code_workflow: form.code_workflow ? form.code_workflow : null,
        rubrique_paie_code_tva: form.rubrique_paie_code_tva ? form.rubrique_paie_code_tva : null,
        rubrique_paie_lib_tva: form.rubrique_paie_lib_tva ? form.rubrique_paie_lib_tva : null,
      };
      if (verrouillerCode) await pretsApi.modifierType(form.code, payload);
      else await pretsApi.creerType(payload);
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            {verrouillerCode ? "Modifier le type de prêt" : initial ? "Dupliquer le type de prêt" : "Nouveau type de prêt"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Identité */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1 block">Code</Label>
              <Input value={form.code} disabled={verrouillerCode} onChange={e => set("code", e.target.value.toUpperCase())} placeholder="PRET_SOCIAL" />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Libellé</Label>
              <Input value={form.libelle} onChange={e => set("libelle", e.target.value)} placeholder="Prêt social" />
            </div>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Description</Label>
            <Textarea rows={2} value={form.description ?? ""} onChange={e => set("description", e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1 block">Catégorie</Label>
              <Select value={form.categorie_code} onValueChange={v => set("categorie_code", v)}>
                <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c.code} value={c.code}>{c.libelle}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Origine</Label>
              <Select value={form.origine_code} onValueChange={v => set("origine_code", v)}>
                <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                <SelectContent>
                  {origines.map(o => <SelectItem key={o.code} value={o.code}>{o.libelle}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Conditions financières */}
          <div className="rounded-md border border-border p-3 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Conditions financières</p>
            {estExterne && (
              <p className="text-[11px]" style={{ color: "hsl(var(--info))" }}>
                Sans effet pour un prêt externe — l'échéancier provient de l'établissement de crédit
                (saisi ou importé au niveau du dossier), ces valeurs par défaut ne sont pas utilisées.
              </p>
            )}
            <div className={`grid grid-cols-3 gap-3 ${estExterne ? "opacity-40" : ""}`}>
              <div>
                <Label className="text-xs mb-1 block">Taux annuel par défaut (%)</Label>
                <Input type="number" step="0.01" disabled={estExterne} value={form.taux_annuel_defaut} onChange={e => set("taux_annuel_defaut", Number(e.target.value))} />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Durée max (mois)</Label>
                <Input type="number" disabled={estExterne} value={form.duree_max_mois} onChange={e => set("duree_max_mois", Number(e.target.value))} />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Montant max (DH)</Label>
                <Input type="number" disabled={estExterne} value={form.montant_max ?? ""} onChange={e => set("montant_max", e.target.value ? Number(e.target.value) : null)} />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Ancienneté min. (mois)</Label>
                <Input type="number" disabled={estExterne} value={form.anciennete_min_mois} onChange={e => set("anciennete_min_mois", Number(e.target.value))} />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Algorithme par défaut</Label>
                <Select value={form.algo_defaut} onValueChange={v => set("algo_defaut", v as AlgoAmortissement)} disabled={estExterne}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ALGO_LABELS) as AlgoAmortissement[]).map(a => (
                      <SelectItem key={a} value={a}>{ALGO_LABELS[a]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Nb prêts simultanés max</Label>
                <Input type="number" disabled={estExterne} value={form.nb_max_simultanes} onChange={e => set("nb_max_simultanes", Number(e.target.value))} />
              </div>
            </div>
          </div>

          {/* Rubriques de paie */}
          <div className="rounded-md border border-border p-3 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Imputation en paie</p>
            {erreurRubriques && (
              <p className="text-[11px] rounded-md p-2" style={{ background: "hsl(var(--destructive) / 0.08)", color: "hsl(var(--destructive))" }}>
                ⚠ {erreurRubriques}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1 block">Rubrique (mensualité / capital)</Label>
                <RubriqueAutocomplete
                  value={form.rubrique_paie_code ?? ""}
                  disponibles={rubriquesLibresPour(form.rubrique_paie_code, rubriquesRetenue)}
                  onChange={(code, libelle) => setForm(f => ({ ...f, rubrique_paie_code: code, rubrique_paie_lib: libelle ?? f.rubrique_paie_lib }))}
                  placeholder="Rechercher une rubrique retenue…"
                />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Rubrique intérêts HT (si taux &gt; 0)</Label>
                <RubriqueAutocomplete
                  value={form.rubrique_paie_code_interet ?? ""}
                  disponibles={rubriquesLibresPour(form.rubrique_paie_code_interet, rubriquesInteret)}
                  onChange={(code, libelle) => setForm(f => ({ ...f, rubrique_paie_code_interet: code, rubrique_paie_lib_interet: libelle ?? f.rubrique_paie_lib_interet }))}
                  placeholder="Rechercher une rubrique (hors gain/cotisation)…"
                />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Rubrique TVA intérêts (si taux TVA &gt; 0)</Label>
                <RubriqueAutocomplete
                  value={form.rubrique_paie_code_tva ?? ""}
                  disponibles={rubriquesLibresPour(form.rubrique_paie_code_tva, rubriquesInteret)}
                  onChange={(code, libelle) => setForm(f => ({ ...f, rubrique_paie_code_tva: code, rubrique_paie_lib_tva: libelle ?? f.rubrique_paie_lib_tva }))}
                  placeholder="Rechercher une rubrique (hors gain/cotisation)…"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Mensualité : uniquement les rubriques de famille "Retenue". Intérêts et TVA : toute famille sauf Cotisation (patronale/salariale). Une même rubrique peut être partagée par plusieurs types de prêt.
            </p>
          </div>

          {/* Circuit de validation — isolé pour une révélation progressive du
              sélecteur de processus, plutôt que noyé dans la grille générale */}
          <div className="rounded-md border border-border p-3 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Circuit de validation</p>
            {estExterne ? (
              <p className="text-[11px]" style={{ color: "hsl(var(--info))" }}>
                Pas de circuit de validation pour un prêt externe — la décision revient à l'établissement de crédit.
              </p>
            ) : (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.workflow_actif} onChange={e => set("workflow_actif", e.target.checked)} />
                  Circuit de validation actif
                </label>

                {form.workflow_actif && (
                  <div>
                    <Label className="text-xs mb-1 block">Processus de validation</Label>
                    <Select value={form.code_workflow ?? ""} onValueChange={v => set("code_workflow", v)}>
                      <SelectTrigger><SelectValue placeholder="Sélectionner un processus" /></SelectTrigger>
                      <SelectContent>
                        {workflows.map(w => (
                          <SelectItem key={w.code} value={w.code}>{w.libelle} ({w.type_objet})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {workflows.length === 0 && (
                      <p className="text-[11px] mt-1" style={{ color: "hsl(var(--warning))" }}>
                        Aucun processus disponible avec l'objet métier "generique" ou "prets" — créez-en un dans
                        Configuration → Workflows → Concepteur de workflows.
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Seuls les processus dont l'objet métier est "generique" ou "prets" sont proposés ici.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Comportement */}
          <div className="rounded-md border border-border p-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Comportement</p>
            {estExterne && (
              <p className="text-[11px] mb-1" style={{ color: "hsl(var(--info))" }}>
                Ces options ne s'appliquent qu'aux prêts internes et aux avances sur salaire — sans effet ici pour un prêt externe.
              </p>
            )}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {([
                ["renouvelable", "Renouvelable"],
                ["justificatif_requis", "Justificatif requis"],
                ["double_validation", "Double validation"],
                ["avance_sur_salaire", "Avance sur salaire (borne au 31/12)"],
                ["autorise_remboursement_anticipe", "Remboursement anticipé autorisé"],
                ["autorise_suspension", "Suspension autorisée"],
              ] as [keyof TypePretAdmin, string][]).map(([key, label]) => (
                <label key={key} className={`flex items-center gap-2 text-sm ${estExterne ? "opacity-40" : ""}`}>
                  <input type="checkbox" checked={Boolean(form[key])} disabled={estExterne}
                    onChange={e => set(key, e.target.checked as any)} />
                  {label}
                </label>
              ))}
            </div>
            <div className="pt-1 border-t border-border mt-1">
              <label className="flex items-center gap-2 text-sm mt-2">
                <input type="checkbox" checked={Boolean(form.actif)} onChange={e => set("actif", e.target.checked as any)} />
                Type actif
              </label>
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={enregistrer} disabled={saving || !form.code || !form.libelle || !form.categorie_code || !form.origine_code}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ORIGINES_CONNUES = [
  { code: "INTERNE", libelle: "Prêt interne" },
  { code: "EXTERNE", libelle: "Prêt externe" },
  { code: "AVANCE", libelle: "Avance / Acompte" },
];

type EditionType = { mode: "nouveau" } | { mode: "edition"; data: TypePretAdmin } | { mode: "duplication"; data: TypePretAdmin } | null;

const TypesTab: React.FC<{ categories: CategoriePret[] }> = ({ categories }) => {
  const [types, setTypes] = useState<TypePretAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [edition, setEdition] = useState<EditionType>(null);
  const [afficherArchives, setAfficherArchives] = useState(false);

  const charger = useCallback(async () => {
    setLoading(true);
    try { setTypes(await pretsApi.listerTypesAdmin()); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const visibles = afficherArchives ? types : types.filter(t => t.actif);
  const { sorted, sortKey, sortDir, toggleSort } = useSort<TypePretAdmin>(visibles, "ordre");

  const basculerActif = async (t: TypePretAdmin) => {
    await pretsApi.modifierType(t.code, { ...t, actif: !t.actif });
    charger();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={afficherArchives} onChange={e => setAfficherArchives(e.target.checked)} />
          Afficher les types archivés
        </label>
        <Button size="sm" onClick={() => setEdition({ mode: "nouveau" })}>
          <Plus size={14} className="mr-1.5" /> Nouveau type de prêt
        </Button>
      </div>
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs">
            <tr className="border-b border-border">
              <th className="px-3 py-2 w-10"></th>
              <SortableTh label="Code" sortKey="code" activeKey={sortKey as string} dir={sortDir} onSort={k => toggleSort(k as keyof TypePretAdmin)} />
              <SortableTh label="Libellé" sortKey="libelle" activeKey={sortKey as string} dir={sortDir} onSort={k => toggleSort(k as keyof TypePretAdmin)} />
              <SortableTh label="Catégorie" sortKey="categorie_code" activeKey={sortKey as string} dir={sortDir} onSort={k => toggleSort(k as keyof TypePretAdmin)} />
              <SortableTh label="Taux" sortKey="taux_annuel_defaut" activeKey={sortKey as string} dir={sortDir} onSort={k => toggleSort(k as keyof TypePretAdmin)} />
              <SortableTh label="Durée max" sortKey="duree_max_mois" activeKey={sortKey as string} dir={sortDir} onSort={k => toggleSort(k as keyof TypePretAdmin)} />
              <SortableTh label="Statut" sortKey="actif" activeKey={sortKey as string} dir={sortDir} onSort={k => toggleSort(k as keyof TypePretAdmin)} />
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-8 text-sm text-muted-foreground">Chargement…</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-8 text-sm text-muted-foreground">Aucun type de prêt.</td></tr>
            ) : sorted.map(t => (
              <tr key={t.code} className={`border-t border-border hover:bg-secondary/20 ${!t.actif ? "opacity-60" : ""}`}>
                <td className="px-3 py-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: t.couleur + "20" }}>
                    <DynIcon name={t.icone} size={14} color={t.couleur} />
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{t.code}</td>
                <td className="px-3 py-2 font-medium">{t.libelle}</td>
                <td className="px-3 py-2 text-muted-foreground">{categories.find(c => c.code === t.categorie_code)?.libelle ?? t.categorie_code}</td>
                <td className="px-3 py-2">{t.taux_annuel_defaut === 0 ? "0%" : `${t.taux_annuel_defaut}%`}</td>
                <td className="px-3 py-2 text-muted-foreground">{t.duree_max_mois} mois</td>
                <td className="px-3 py-2"><ActifBadge actif={t.actif} /></td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-[hsl(var(--primary))]" title="Modifier" onClick={() => setEdition({ mode: "edition", data: t })}>
                      <Pencil size={13} />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-[hsl(var(--primary))]" title="Dupliquer"
                      onClick={() => setEdition({ mode: "duplication", data: { ...t, code: "", libelle: `${t.libelle} (copie)` } })}>
                      <Copy size={13} />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-[hsl(var(--warning))]" title={t.actif ? "Archiver" : "Désarchiver"} onClick={() => basculerActif(t)}>
                      {t.actif ? <Archive size={13} /> : <ArchiveRestore size={13} />}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edition && (
        <TypeFormDialog
          initial={edition.mode === "nouveau" ? null : edition.data}
          verrouillerCode={edition.mode === "edition"}
          categories={categories}
          origines={ORIGINES_CONNUES}
          allTypes={types}
          onClose={() => setEdition(null)}
          onSaved={() => { setEdition(null); charger(); }}
        />
      )}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// RÈGLES D'ÉLIGIBILITÉ
// ──────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────
// SAISIE INTUITIVE DES PARAMÈTRES — un champ typé + aide par règle,
// au lieu d'un JSON brut. Repli en JSON pour toute règle future non
// répertoriée ici (le catalogue backend reste la source de vérité).
// ──────────────────────────────────────────────────────────────

interface ChampRegle {
  key: string;
  label: string;
  type: "integer" | "percent" | "montant" | "liste";
  suffixe?: string;
  placeholder?: string;
  aide: string;
}

const CHAMPS_PAR_REGLE: Record<string, ChampRegle[]> = {
  ANCIENNETE_MIN: [
    { key: "mois", label: "Ancienneté minimale requise", type: "integer", suffixe: "mois",
      aide: "Bloque la demande si le collaborateur a moins de cette ancienneté (en mois) à la date de la demande." },
  ],
  TYPE_CONTRAT_AUTORISE: [
    { key: "contrats", label: "Types de contrat autorisés", type: "liste", placeholder: "Ex. CDI",
      aide: "Codes des types de contrat pouvant bénéficier de ce type de prêt. Tapez un code puis Entrée pour l'ajouter." },
  ],
  QUOTITE_SAISISSABLE: [
    { key: "pourcent_max", label: "Quotité saisissable maximale", type: "percent", suffixe: "%",
      aide: "Plafond du salaire net imposable pouvant être consacré au cumul des mensualités de prêts (plafond légal usuel : 30%)." },
  ],
  NB_PRETS_SIMULTANES_MAX: [
    { key: "nb_max", label: "Nombre maximum de prêts simultanés", type: "integer",
      aide: "Nombre de prêts de ce type qu'un même collaborateur peut avoir actifs en même temps." },
  ],
  MONTANT_MAX: [
    { key: "montant", label: "Montant maximum autorisé", type: "montant", suffixe: "DH",
      aide: "Plafond du montant qui peut être demandé pour ce type de prêt." },
  ],
  CUMUL_ENCOURS_MAX: [
    { key: "montant", label: "Plafond de cumul des encours", type: "montant", suffixe: "DH",
      aide: "Bloque si le capital restant dû cumulé de tous les prêts du collaborateur dépasserait ce montant." },
  ],
  DELAI_ENTRE_DEUX_PRETS: [
    { key: "mois", label: "Délai de carence entre deux prêts", type: "integer", suffixe: "mois",
      aide: "Nombre de mois à attendre après le solde d'un prêt de ce type avant d'en redemander un autre." },
  ],
  ECHEANCE_BORNEE_ANNEE_CIVILE: [],
};

const ChampRegleInput: React.FC<{
  champ: ChampRegle; valeur: any; onChange: (v: any) => void;
}> = ({ champ, valeur, onChange }) => {
  const [saisie, setSaisie] = useState("");

  if (champ.type === "liste") {
    const items: string[] = Array.isArray(valeur) ? valeur : [];
    const ajouterItem = () => {
      const v = saisie.trim().toUpperCase();
      if (v && !items.includes(v)) onChange([...items, v]);
      setSaisie("");
    };
    return (
      <div>
        <Label className="text-xs mb-1 block">{champ.label}</Label>
        <div className="flex gap-2">
          <Input
            value={saisie} placeholder={champ.placeholder}
            onChange={e => setSaisie(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); ajouterItem(); } }}
          />
          <Button type="button" variant="outline" size="sm" onClick={ajouterItem}>Ajouter</Button>
        </div>
        {items.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {items.map(v => (
              <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono bg-secondary">
                {v}
                <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => onChange(items.filter(x => x !== v))}>×</button>
              </span>
            ))}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-1">{champ.aide}</p>
      </div>
    );
  }

  return (
    <div>
      <Label className="text-xs mb-1 block">{champ.label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="number" min={0} step={champ.type === "percent" ? "0.1" : "1"}
          value={valeur ?? ""} onChange={e => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
        {champ.suffixe && <span className="text-xs text-muted-foreground shrink-0">{champ.suffixe}</span>}
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">{champ.aide}</p>
    </div>
  );
};

const ReglesTab: React.FC<{ types: TypePretAdmin[] }> = ({ types }) => {
  const [typeCode, setTypeCode] = useState<string>("");
  const [catalogue, setCatalogue] = useState<RegleCatalogue[]>([]);
  const [regles, setRegles] = useState<TypeRegle[]>([]);
  const [loading, setLoading] = useState(false);
  const [edition, setEdition] = useState<{ mode: "ajout" } | { mode: "edition"; regle: TypeRegle } | null>(null);
  const [codeRegle, setCodeRegle] = useState("");
  const [niveau, setNiveau] = useState<"BLOQUANT" | "ALERTE">("BLOQUANT");
  const [derogationAutorisee, setDerogationAutorisee] = useState(false);
  const [valeurs, setValeurs] = useState<Record<string, any>>({});
  const [modeAvance, setModeAvance] = useState(false);
  const [parametresJson, setParametresJson] = useState("{}");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { pretsApi.catalogueRegles().then(setCatalogue).catch(() => {}); }, []);

  const chargerRegles = useCallback(async (tc: string) => {
    if (!tc) { setRegles([]); return; }
    setLoading(true);
    try { setRegles(await pretsApi.listerReglesType(tc)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { chargerRegles(typeCode); }, [typeCode, chargerRegles]);

  const champsDeLaRegleChoisie = CHAMPS_PAR_REGLE[codeRegle];
  const reglePasRepertoriee = codeRegle !== "" && !champsDeLaRegleChoisie;

  const choisirRegle = (code: string) => {
    setCodeRegle(code);
    setValeurs({});
    setModeAvance(reglePasRepertoriee);
    setParametresJson("{}");
  };

  const ouvrirAjout = () => {
    setCodeRegle(""); setValeurs({}); setNiveau("BLOQUANT"); setDerogationAutorisee(false);
    setModeAvance(false); setParametresJson("{}"); setError(null);
    setEdition({ mode: "ajout" });
  };

  const ouvrirEdition = (r: TypeRegle) => {
    setCodeRegle(r.code_regle);
    setNiveau(r.niveau);
    setDerogationAutorisee(r.derogation_rh_autorisee);
    setError(null);
    const champs = CHAMPS_PAR_REGLE[r.code_regle];
    if (champs) {
      setValeurs(r.parametres ?? {});
      setModeAvance(false);
    } else {
      setModeAvance(true);
      setParametresJson(JSON.stringify(r.parametres ?? {}, null, 2));
    }
    setEdition({ mode: "edition", regle: r });
  };

  const fermerDialogue = () => setEdition(null);

  const enregistrerRegle = async () => {
    setError(null);
    let parametres: Record<string, unknown> = {};

    if (modeAvance || reglePasRepertoriee) {
      try { parametres = JSON.parse(parametresJson || "{}"); }
      catch { setError("Les paramètres doivent être un JSON valide, ex. {\"mois\": 12}"); return; }
    } else {
      const champsManquants = (champsDeLaRegleChoisie ?? []).filter(c => valeurs[c.key] === undefined || valeurs[c.key] === "");
      if (champsManquants.length > 0) { setError(`Merci de renseigner : ${champsManquants.map(c => c.label).join(", ")}`); return; }
      parametres = valeurs;
    }

    try {
      if (edition?.mode === "edition") {
        await pretsApi.modifierRegleType(typeCode, edition.regle.id, {
          code_regle: codeRegle, niveau, derogation_rh_autorisee: derogationAutorisee,
          parametres, ordre: edition.regle.ordre, actif: edition.regle.actif,
        });
      } else {
        await pretsApi.ajouterRegleType(typeCode, {
          code_regle: codeRegle, niveau, derogation_rh_autorisee: derogationAutorisee, parametres, ordre: 10, actif: true,
        });
      }
      setEdition(null);
      chargerRegles(typeCode);
    } catch (e: any) {
      setError(e?.message ?? "Erreur lors de l'enregistrement de la règle.");
    }
  };

  const retirer = async (regleId: string) => {
    if (!confirm("Retirer cette règle de ce type de prêt ?")) return;
    await pretsApi.retirerRegleType(typeCode, regleId);
    chargerRegles(typeCode);
  };

  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <Label className="text-xs mb-1 block">Type de prêt</Label>
        <Select value={typeCode} onValueChange={setTypeCode}>
          <SelectTrigger><SelectValue placeholder="Sélectionner un type" /></SelectTrigger>
          <SelectContent>
            {types.map(t => <SelectItem key={t.code} value={t.code}>{t.libelle}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {typeCode && (
        <>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={ouvrirAjout}>
              <Plus size={14} className="mr-1.5" /> Attacher une règle
            </Button>
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs">
                <tr className="border-b border-border">
                  {["Règle", "Niveau", "Paramètres", "Dérogation RH", ""].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="text-center py-8 text-sm text-muted-foreground">Chargement…</td></tr>
                ) : regles.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-sm text-muted-foreground">Aucune règle attachée à ce type.</td></tr>
                ) : regles.map(r => (
                  <tr key={r.id} className="border-t border-border hover:bg-secondary/20">
                    <td className="px-3 py-2 font-medium">{catalogue.find(c => c.code === r.code_regle)?.libelle ?? r.code_regle}</td>
                    <td className="px-3 py-2">
                      <span
                        className="px-2 py-0.5 rounded-full text-[11px] font-medium"
                        style={r.niveau === "BLOQUANT"
                          ? { background: "hsl(var(--destructive) / 0.12)", color: "hsl(var(--destructive))" }
                          : { background: "hsl(var(--warning) / 0.12)", color: "hsl(var(--warning))" }}
                      >
                        {r.niveau}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{JSON.stringify(r.parametres)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.derogation_rh_autorisee ? "Oui" : "Non"}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-[hsl(var(--primary))]" title="Modifier" onClick={() => ouvrirEdition(r)}>
                          <Pencil size={13} />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" title="Retirer" onClick={() => retirer(r.id)}>
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {edition && (
        <Dialog open onOpenChange={(v) => !v && fermerDialogue()}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base">{edition.mode === "edition" ? "Modifier la règle" : "Attacher une règle"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-xs mb-1 block">Règle du catalogue</Label>
                <Select value={codeRegle} onValueChange={choisirRegle} disabled={edition.mode === "edition"}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                  <SelectContent>
                    {catalogue.map(c => <SelectItem key={c.code} value={c.code}>{c.libelle}</SelectItem>)}
                  </SelectContent>
                </Select>
                {catalogue.find(c => c.code === codeRegle)?.description && (
                  <p className="text-[11px] text-muted-foreground mt-1.5 rounded-md p-2" style={{ background: "hsl(var(--info) / 0.08)" }}>
                    {catalogue.find(c => c.code === codeRegle)?.description}
                  </p>
                )}
              </div>

              {codeRegle && !modeAvance && champsDeLaRegleChoisie && champsDeLaRegleChoisie.length === 0 && (
                <p className="text-xs text-muted-foreground">Cette règle n'a besoin d'aucun paramètre supplémentaire.</p>
              )}

              {codeRegle && !modeAvance && champsDeLaRegleChoisie && champsDeLaRegleChoisie.length > 0 && (
                <div className="space-y-3">
                  {champsDeLaRegleChoisie.map(champ => (
                    <ChampRegleInput
                      key={champ.key} champ={champ} valeur={valeurs[champ.key]}
                      onChange={v => setValeurs(prev => ({ ...prev, [champ.key]: v }))}
                    />
                  ))}
                </div>
              )}

              {codeRegle && (modeAvance || reglePasRepertoriee) && (
                <div>
                  <Label className="text-xs mb-1 block">Paramètres (JSON)</Label>
                  <Textarea rows={3} value={parametresJson} onChange={e => setParametresJson(e.target.value)} />
                  {reglePasRepertoriee && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Règle non répertoriée dans le formulaire simplifié — saisie en JSON brut.
                      {catalogue.find(c => c.code === codeRegle)?.parametres_attendus && (
                        <> Format attendu : <code>{catalogue.find(c => c.code === codeRegle)?.parametres_attendus}</code></>
                      )}
                    </p>
                  )}
                </div>
              )}

              {codeRegle && champsDeLaRegleChoisie && champsDeLaRegleChoisie.length > 0 && (
                <button type="button" className="text-[11px] text-primary underline" onClick={() => setModeAvance(m => !m)}>
                  {modeAvance ? "Revenir au formulaire simplifié" : "Basculer en saisie JSON avancée"}
                </button>
              )}

              <div>
                <Label className="text-xs mb-1 block">Niveau</Label>
                <Select value={niveau} onValueChange={v => setNiveau(v as "BLOQUANT" | "ALERTE")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BLOQUANT">Bloquant — empêche la demande tant que la condition n'est pas respectée</SelectItem>
                    <SelectItem value="ALERTE">Alerte — signale, sans bloquer, le gestionnaire décide</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={derogationAutorisee} onChange={e => setDerogationAutorisee(e.target.checked)} />
                Dérogation RH autorisée (contournement tracé)
              </label>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={fermerDialogue}>Annuler</Button>
              <Button onClick={enregistrerRegle} disabled={!codeRegle}>
                {edition.mode === "edition" ? "Enregistrer" : "Attacher"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// PAGE PRINCIPALE
// ──────────────────────────────────────────────────────────────

const ParametragePretsPage: React.FC = () => {
  const [categories, setCategories] = useState<CategoriePret[]>([]);
  const [types, setTypes] = useState<TypePretAdmin[]>([]);
  const [tab, setTab] = useState("categories");

  useEffect(() => {
    pretsApi.listerCategories().then(setCategories).catch(() => {});
    pretsApi.listerTypesAdmin().then(setTypes).catch(() => {});
  }, [tab]);

  return (
    <div className="w-full">
      <div className="flex items-center gap-1.5 px-4 pt-4 pb-2 text-[13px] text-muted-foreground">
        <Settings2 size={13} />
        <span>Paramétrage</span>
        <span style={{ opacity: 0.5 }}>/</span>
        <span className="font-semibold text-foreground">Prêts &amp; Avances</span>
      </div>

      <div className="px-4 py-6 space-y-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="categories">Catégories</TabsTrigger>
            <TabsTrigger value="types">Types de prêt</TabsTrigger>
            <TabsTrigger value="regles">Règles d'éligibilité</TabsTrigger>
          </TabsList>

          <TabsContent value="categories" className="mt-4">
            <CategoriesTab />
          </TabsContent>
          <TabsContent value="types" className="mt-4">
            <TypesTab categories={categories} />
          </TabsContent>
          <TabsContent value="regles" className="mt-4">
            <ReglesTab types={types} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default ParametragePretsPage;
