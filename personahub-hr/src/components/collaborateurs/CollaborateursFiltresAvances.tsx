/**
 * CollaborateursFiltresAvances — modale de filtres multi-critères.
 *
 * v2 (18/05/2026) :
 *  ✓ Nouvelle section "Affectation" avec cases :
 *      - Sans affectation à une UO
 *      - Sans affectation à un poste
 *  ✓ Sélecteur UO transformé en arbre dépliable avec tri-state :
 *      - Cocher une UO racine coche tous ses descendants
 *      - Décocher manuellement un descendant met la racine en état "partiel"
 *      - Recherche déplie automatiquement les branches matchantes
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, Filter, RotateCcw, Check, ChevronRight, ChevronDown } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface FiltresAvances {
  // Contrat
  type_contrat_codes: string[];
  // Organisation
  societe_ids: string[];
  etablissement_ids: string[];
  uo_ids: string[];                     // IDs effectivement sélectionnés (avec descendants si cascade)
  // Affectation (NOUVEAU)
  sans_uo: boolean;                     // collab sans aucune UO active
  sans_poste: boolean;                  // collab sans poste actif
  // Identité
  genres: string[];
  code_nationalites: string[];
  // Dates
  date_embauche_debut: string;
  date_embauche_fin: string;
  anciennete_min: string;
  anciennete_max: string;
  // Booléens
  has_mandat_syndical: boolean | null;
}

export const EMPTY_FILTRES: FiltresAvances = {
  type_contrat_codes: [],
  societe_ids: [],
  etablissement_ids: [],
  uo_ids: [],
  sans_uo: false,
  sans_poste: false,
  genres: [],
  code_nationalites: [],
  date_embauche_debut: "",
  date_embauche_fin: "",
  anciennete_min: "",
  anciennete_max: "",
  has_mandat_syndical: null,
};

export function countFiltres(f: FiltresAvances): number {
  let n = 0;
  if (f.type_contrat_codes.length) n++;
  if (f.societe_ids.length) n++;
  if (f.etablissement_ids.length) n++;
  if (f.uo_ids.length) n++;
  if (f.sans_uo) n++;
  if (f.sans_poste) n++;
  if (f.genres.length) n++;
  if (f.code_nationalites.length) n++;
  if (f.date_embauche_debut || f.date_embauche_fin) n++;
  if (f.anciennete_min || f.anciennete_max) n++;
  if (f.has_mandat_syndical !== null) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
interface RefOpt {
  value: string;
  label: string;
}

/** Option UO enrichie avec la hiérarchie (parent_id null = racine). */
export interface UoOpt {
  value: string;
  label: string;
  parent_id: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  value: FiltresAvances;
  onApply: (f: FiltresAvances) => void;
  optTypesContrat: RefOpt[];
  optSocietes: RefOpt[];
  optEtablissements: RefOpt[];
  optUOs: UoOpt[];
  optGenres: RefOpt[];
  optNationalites: RefOpt[];
}

// ---------------------------------------------------------------------------
// Helpers visuels
// ---------------------------------------------------------------------------
const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p
    className="text-xs font-bold uppercase tracking-wider pb-1 mb-2 mt-5 border-b first:mt-0"
    style={{ color: "hsl(var(--accent))", borderColor: "hsl(var(--border))" }}
  >
    {children}
  </p>
);

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label
    className="block text-xs font-medium mb-1"
    style={{ color: "hsl(var(--muted-foreground))" }}
  >
    {children}
  </label>
);

const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input
    {...props}
    className="w-full px-3 py-2 rounded-lg border text-sm outline-none transition-all"
    style={{
      borderColor: "hsl(var(--border))",
      background: "hsl(var(--background))",
      color: "hsl(var(--foreground))",
      minHeight: 36,
    }}
    onFocus={(e) => (e.currentTarget.style.borderColor = "hsl(var(--accent))")}
    onBlur={(e) => (e.currentTarget.style.borderColor = "hsl(var(--border))")}
  />
);

// ---------------------------------------------------------------------------
// MultiCheck simple (utilisé pour tous les multi-select non hiérarchiques)
// ---------------------------------------------------------------------------
const MultiCheck: React.FC<{
  options: RefOpt[];
  values: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}> = ({ options, values, onChange, disabled = false }) => {
  const [search, setSearch] = useState("");
  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (v: string) => {
    if (values.includes(v)) onChange(values.filter((x) => x !== v));
    else onChange([...values, v]);
  };

  if (options.length === 0) {
    return (
      <p className="text-xs italic" style={{ color: "hsl(var(--muted-foreground))" }}>
        Aucune option disponible
      </p>
    );
  }

  return (
    <div style={{ opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? "none" : "auto" }}>
      {options.length > 8 && (
        <Input
          type="search"
          placeholder="Rechercher…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-2"
        />
      )}
      <div
        className="space-y-1 max-h-44 overflow-y-auto rounded-lg border p-2"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        {filtered.length === 0 ? (
          <p
            className="text-xs italic px-1"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Aucun résultat
          </p>
        ) : (
          filtered.map((o) => {
            const checked = values.includes(o.value);
            return (
              <label
                key={o.value}
                className="flex items-center gap-2 cursor-pointer text-sm select-none px-1 py-0.5 rounded hover:bg-muted/40"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(o.value)}
                  className="h-4 w-4 cursor-pointer"
                  style={{ accentColor: "hsl(var(--accent))" }}
                />
                <span style={{ color: "hsl(var(--foreground))" }}>{o.label}</span>
              </label>
            );
          })
        )}
      </div>
      {values.length > 0 && (
        <p className="text-[11px] mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
          {values.length} sélectionné{values.length > 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// TreeNode (interne) : nœud d'arbre avec checkbox tri-state
// ---------------------------------------------------------------------------
interface TreeNode {
  id: string;
  label: string;
  children: TreeNode[];
}

/** Build forest from flat list of UoOpt. */
function buildForest(opts: UoOpt[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  opts.forEach((o) => byId.set(o.value, { id: o.value, label: o.label, children: [] }));

  const roots: TreeNode[] = [];
  opts.forEach((o) => {
    const node = byId.get(o.value)!;
    if (o.parent_id && byId.has(o.parent_id)) {
      byId.get(o.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  // Tri alphabétique récursif
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.label.localeCompare(b.label, "fr"));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

/** Collecte récursive des descendants (incluant ou non le nœud lui-même). */
function collectDescendants(node: TreeNode, includeSelf = true): string[] {
  const result: string[] = includeSelf ? [node.id] : [];
  node.children.forEach((c) => result.push(...collectDescendants(c, true)));
  return result;
}

/** Renvoie l'ensemble des nœuds dont le label ou un descendant matche la recherche. */
function buildMatchSet(nodes: TreeNode[], search: string): Set<string> {
  const matches = new Set<string>();
  const s = search.toLowerCase();
  const walk = (node: TreeNode): boolean => {
    const selfMatch = node.label.toLowerCase().includes(s);
    let childMatch = false;
    node.children.forEach((c) => {
      if (walk(c)) childMatch = true;
    });
    if (selfMatch || childMatch) {
      matches.add(node.id);
      return true;
    }
    return false;
  };
  nodes.forEach(walk);
  return matches;
}

// ---------------------------------------------------------------------------
// TreeMultiCheck : checkbox arborescente avec tri-state
// ---------------------------------------------------------------------------
const TreeMultiCheck: React.FC<{
  options: UoOpt[];
  values: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}> = ({ options, values, onChange, disabled = false }) => {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const forest = useMemo(() => buildForest(options), [options]);
  const matches = useMemo(
    () => (search ? buildMatchSet(forest, search) : null),
    [forest, search]
  );

  // Pour la recherche : déplier automatiquement toutes les branches matchantes
  const visibleExpanded = useMemo(() => {
    if (!matches) return expanded;
    // En mode recherche, on déplie tout pour montrer les matches
    const all = new Set<string>(expanded);
    matches.forEach((id) => all.add(id));
    return all;
  }, [expanded, matches]);

  const valueSet = useMemo(() => new Set(values), [values]);

  const toggle = (node: TreeNode) => {
    const descIds = collectDescendants(node, true);
    const allChecked = descIds.every((id) => valueSet.has(id));
    const someChecked = descIds.some((id) => valueSet.has(id));

    if (allChecked) {
      // tout coché → tout décocher
      onChange(values.filter((v) => !descIds.includes(v)));
    } else if (someChecked) {
      // partiel → tout cocher (état "compléter la sélection")
      const next = new Set(values);
      descIds.forEach((id) => next.add(id));
      onChange(Array.from(next));
    } else {
      // rien coché → tout cocher
      onChange([...values, ...descIds]);
    }
  };

  const toggleExpand = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  /** État tri-state d'un nœud, dérivé de l'arbre + values */
  const getState = (node: TreeNode): "checked" | "partial" | "unchecked" => {
    const descIds = collectDescendants(node, true);
    const checkedCount = descIds.filter((id) => valueSet.has(id)).length;
    if (checkedCount === 0) return "unchecked";
    if (checkedCount === descIds.length) return "checked";
    return "partial";
  };

  /** Rendu récursif d'un nœud + ses enfants. */
  const renderNode = (node: TreeNode, depth: number) => {
    if (matches && !matches.has(node.id)) return null; // filtrage recherche

    const state = getState(node);
    const isExpanded = visibleExpanded.has(node.id);
    const hasChildren = node.children.length > 0;

    return (
      <React.Fragment key={node.id}>
        <div
          className="flex items-center gap-1 text-sm select-none rounded hover:bg-muted/40 py-0.5"
          style={{ paddingLeft: depth * 16 }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleExpand(node.id)}
              className="p-0.5 rounded hover:bg-muted/60"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : (
            <span style={{ width: 18 }} /> /* placeholder pour aligner */
          )}
          <label className="flex items-center gap-2 cursor-pointer flex-1 py-0.5">
            <TriStateCheckbox state={state} onClick={() => toggle(node)} />
            <span style={{ color: "hsl(var(--foreground))" }}>{node.label}</span>
          </label>
        </div>
        {hasChildren && isExpanded && (
          <>{node.children.map((c) => renderNode(c, depth + 1))}</>
        )}
      </React.Fragment>
    );
  };

  if (options.length === 0) {
    return (
      <p className="text-xs italic" style={{ color: "hsl(var(--muted-foreground))" }}>
        Aucune unité disponible
      </p>
    );
  }

  return (
    <div style={{ opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? "none" : "auto" }}>
      <Input
        type="search"
        placeholder="Rechercher une UO…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-2"
      />
      <div
        className="max-h-72 overflow-y-auto rounded-lg border p-2"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        {forest.length === 0 ? (
          <p
            className="text-xs italic px-1"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Aucun résultat
          </p>
        ) : (
          forest.map((root) => renderNode(root, 0))
        )}
      </div>
      {values.length > 0 && (
        <p className="text-[11px] mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
          {values.length} unité{values.length > 1 ? "s" : ""} sélectionnée{values.length > 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
};

/** Checkbox HTML avec état indéterminé piloté via ref. */
const TriStateCheckbox: React.FC<{
  state: "checked" | "partial" | "unchecked";
  onClick: () => void;
}> = ({ state, onClick }) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "partial";
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state === "checked"}
      onChange={onClick}
      className="h-4 w-4 cursor-pointer"
      style={{ accentColor: "hsl(var(--accent))" }}
    />
  );
};

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------
const CollaborateursFiltresAvances: React.FC<Props> = ({
  open,
  onClose,
  value,
  onApply,
  optTypesContrat,
  optSocietes,
  optEtablissements,
  optUOs,
  optGenres,
  optNationalites,
}) => {
  const [draft, setDraft] = useState<FiltresAvances>(value);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  if (!open) return null;

  const reset = () => setDraft(EMPTY_FILTRES);
  const apply = () => {
    onApply(draft);
    onClose();
  };
  const set = <K extends keyof FiltresAvances>(k: K, v: FiltresAvances[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: "hsl(0 0% 0% / 0.5)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md h-full flex flex-col shadow-2xl"
        style={{ background: "hsl(var(--card))", borderLeft: "1px solid hsl(var(--border))" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <div className="flex items-center gap-2">
            <Filter size={18} style={{ color: "hsl(var(--accent))" }} />
            <h2
              className="font-semibold text-base"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Filtres avancés
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            type="button"
          >
            <X size={16} style={{ color: "hsl(var(--muted-foreground))" }} />
          </button>
        </div>

        {/* Body scrollable */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {/* ── Contrat ── */}
          <SectionTitle>Contrat</SectionTitle>
          <Label>Type de contrat</Label>
          <MultiCheck
            options={optTypesContrat}
            values={draft.type_contrat_codes}
            onChange={(v) => set("type_contrat_codes", v)}
          />

          <div className="mt-4">
            <Label>Date d'embauche</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="date"
                value={draft.date_embauche_debut}
                onChange={(e) => set("date_embauche_debut", e.target.value)}
                placeholder="Du"
              />
              <Input
                type="date"
                value={draft.date_embauche_fin}
                onChange={(e) => set("date_embauche_fin", e.target.value)}
                placeholder="Au"
              />
            </div>
          </div>

          <div className="mt-4">
            <Label>Ancienneté (années)</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                min={0}
                max={60}
                value={draft.anciennete_min}
                onChange={(e) => set("anciennete_min", e.target.value)}
                placeholder="Min"
              />
              <Input
                type="number"
                min={0}
                max={60}
                value={draft.anciennete_max}
                onChange={(e) => set("anciennete_max", e.target.value)}
                placeholder="Max"
              />
            </div>
          </div>

          {/* ── Affectation ── NOUVEAU */}
          <SectionTitle>Affectation</SectionTitle>
          <div
            className="space-y-2 rounded-lg border p-3"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={draft.sans_uo}
                onChange={(e) => set("sans_uo", e.target.checked)}
                className="h-4 w-4 cursor-pointer"
                style={{ accentColor: "hsl(var(--accent))" }}
              />
              <span style={{ color: "hsl(var(--foreground))" }}>
                Sans affectation à une UO
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={draft.sans_poste}
                onChange={(e) => set("sans_poste", e.target.checked)}
                className="h-4 w-4 cursor-pointer"
                style={{ accentColor: "hsl(var(--accent))" }}
              />
              <span style={{ color: "hsl(var(--foreground))" }}>
                Sans affectation à un poste
              </span>
            </label>
          </div>
          {draft.sans_uo && draft.uo_ids.length > 0 && (
            <p
              className="text-[11px] mt-2 italic"
              style={{ color: "hsl(45 100% 30%)" }}
            >
              "Sans UO" est activé : la sélection d'UO ci-dessous est ignorée.
            </p>
          )}

          {/* ── Organisation ── */}
          <SectionTitle>Organisation</SectionTitle>
          <Label>Société</Label>
          <MultiCheck
            options={optSocietes}
            values={draft.societe_ids}
            onChange={(v) => set("societe_ids", v)}
          />

          <div className="mt-4">
            <Label>Établissement</Label>
            <MultiCheck
              options={optEtablissements}
              values={draft.etablissement_ids}
              onChange={(v) => set("etablissement_ids", v)}
            />
          </div>

          <div className="mt-4">
            <Label>Unité organisationnelle (cocher une UO inclut ses sous-UO)</Label>
            <TreeMultiCheck
              options={optUOs}
              values={draft.uo_ids}
              onChange={(v) => set("uo_ids", v)}
              disabled={draft.sans_uo}
            />
          </div>

          {/* ── Identité ── */}
          <SectionTitle>Identité</SectionTitle>
          <Label>Genre</Label>
          <MultiCheck
            options={optGenres}
            values={draft.genres}
            onChange={(v) => set("genres", v)}
          />

          <div className="mt-4">
            <Label>Nationalité</Label>
            <MultiCheck
              options={optNationalites}
              values={draft.code_nationalites}
              onChange={(v) => set("code_nationalites", v)}
            />
          </div>

          {/* ── Représentation ── */}
          <SectionTitle>Représentation</SectionTitle>
          <Label>Mandat syndical</Label>
          <div className="flex gap-2">
            {[
              { v: null, label: "Indifférent" },
              { v: true, label: "Avec mandat" },
              { v: false, label: "Sans mandat" },
            ].map((o) => {
              const active = draft.has_mandat_syndical === o.v;
              return (
                <button
                  key={String(o.v)}
                  onClick={() => set("has_mandat_syndical", o.v as boolean | null)}
                  className="flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-colors"
                  style={{
                    background: active ? "hsl(var(--accent))" : "transparent",
                    borderColor: active ? "hsl(var(--accent))" : "hsl(var(--border))",
                    color: active ? "white" : "hsl(var(--foreground))",
                  }}
                  type="button"
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between gap-3 px-6 py-4 border-t"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <button
            onClick={reset}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
            }}
            type="button"
          >
            <RotateCcw size={12} /> Réinitialiser
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors"
              style={{
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--foreground))",
              }}
              type="button"
            >
              Annuler
            </button>
            <button
              onClick={apply}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
              style={{ background: "hsl(var(--accent))", color: "white" }}
              type="button"
            >
              <Check size={14} /> Appliquer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CollaborateursFiltresAvances;
