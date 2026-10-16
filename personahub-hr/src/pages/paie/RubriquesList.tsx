/**
 * RubriquesList – Liste des rubriques de paie avec filtres et export.
 */
import React, { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Settings, Plus, Pencil, Trash2, Loader2, Download, Search, ChevronDown, ChevronUp, Copy, GripVertical, AlertTriangle } from "lucide-react";
import * as XLSX from "xlsx";
import { useTableSort } from "@/hooks/useTableSort";
import { setListNavigationContext } from "@/hooks/useListNavigationContext";
import MultiSelectFilter from "@/components/paie/MultiSelectFilter";

interface Ref { code: string; libelle: string }
interface Rubrique {
  code: string; libelle: string; libelle_edition: string | null; description: string | null;
  code_famille: string | null; code_flux: string | null; code_type: string | null; code_frequence: string | null;
  frequence_calcul: string; frequence_raz_cumuls: string;
  date_debut: string | null; date_fin: string | null;
  traiter: boolean; simulation: boolean; v_batch: boolean; v_externe: boolean; v_ajout: boolean;
  v_forcage: boolean; v_regularisation: boolean; v_glissant: boolean; v_historique: boolean; pr_cumulee: boolean;
  ordre_calcul: number | null; conditionnee: boolean; code_regle: string | null; archive: boolean;
}

const FREQ_LABELS: Record<string, string> = {
  MENSUELLE: "Mensuelle", PERIODIQUE: "Périodique", TRIMESTRIELLE: "Trimestrielle",
  SEMESTRIELLE: "Semestrielle", ANNUELLE: "Annuelle",
};
interface Imputation {
  id?: string; code_rubrique: string; numero_imputation: number; code_compte: string; sens: string;
}
// RG-RUB-DEPENDANCES-01 (Adil DAIA) : structures minimales pour bâtir le
// graphe "cette rubrique doit être calculée après celles-ci" avant d'autoriser
// un changement d'ordre par glisser-déposer.
interface AlimentationLite { code_rubrique: string; source_type: string; rubrique_source: string | null }
interface RegleSpecifiqueLite { code: string; instructions_text: string | null }
// RG-RUB-DEPENDANCES-04 (Adil DAIA) : pour reproduire fidèlement _dependances()
// côté moteur — une assiette référencée n'est JAMAIS une dépendance directe
// (elle n'a pas d'ordre_calcul significatif, cf. RG-RUB-DEPENDANCES-03),
// elle est EXPANSÉE vers l'ensemble de ses contributeurs réels.
interface ContributeurAssietteLite { code_rubrique: string; code_assiette: string }
interface ComposanteCotisationLite {
  code_rubrique_part_salariale: string | null; code_rubrique_part_patronale: string | null; code_rubrique_assiette: string | null;
}

const BOOL_FLAGS: { key: keyof Rubrique; label: string }[] = [
  { key: "traiter", label: "Traiter" }, { key: "simulation", label: "Simulation" },
  { key: "v_batch", label: "Batch" }, { key: "v_externe", label: "Externe" },
  { key: "v_ajout", label: "Ajout" }, { key: "v_forcage", label: "Forçage" },
  { key: "v_regularisation", label: "Régul." }, { key: "v_glissant", label: "Glissant" },
  { key: "v_historique", label: "Historique" }, { key: "pr_cumulee", label: "Pr.Cumulée" },
  { key: "conditionnee", label: "Conditionnée" },
];

// Couleurs par type de rubrique — dérivées des variables CSS du thème (une
// teinte par catégorie), au lieu de la palette Tailwind figée d'origine qui
// ne suivait pas le thème/mode sombre choisi par l'utilisateur.
const getCodeColorStyle = (codeType: string | null): React.CSSProperties => {
  const token = codeType === "ASS" ? "--info"
    : codeType === "CALC" ? "--primary"
    : codeType === "BASE" ? "--success"
    : codeType === "COT" ? "--warning"
    : codeType === "ALIM" ? "--accent"
    : "--accent";
  return { background: `hsl(var(${token}) / 0.12)`, color: `hsl(var(${token}))`, borderColor: `hsl(var(${token}) / 0.25)` };
};

// Même palette que getCodeColorStyle, exposée en style de badge réutilisable
// pour la colonne "Type" (mêmes teintes que le code, pour renforcer visuellement
// le lien entre les deux colonnes).
const getTypeBadgeStyle = (codeType: string | null): React.CSSProperties => getCodeColorStyle(codeType);

// Flux : ensemble de valeurs fixe et porteur de sens métier (Gain = entrée
// d'argent, Retenue = sortie, Neutre = ni l'un ni l'autre) → mapping explicite
// plutôt qu'une couleur arbitraire, pour rester lisible d'un coup d'œil.
const getFluxBadgeStyle = (codeFlux: string | null): React.CSSProperties => {
  const c = (codeFlux || "").toUpperCase();
  const token = c === "GAIN" ? "--success"
    : c === "RETENUE" ? "--destructive"
    : c === "NEUTRE" || c === "INFORMATIF" ? "--muted-foreground"
    : "--secondary";
  return { background: `hsl(var(${token}) / 0.12)`, color: `hsl(var(${token}))`, borderColor: `hsl(var(${token}) / 0.25)` };
};

// Familles : codes libres/dynamiques (table ref_famille_rubrique_paie), sans
// signification métier fixe → une teinte stable est dérivée par hash du code,
// piochée dans la palette de tokens du thème, pour une couleur cohérente
// d'un rendu à l'autre sans dépendre d'une liste figée de familles connues.
const FAMILLE_PALETTE = ["--primary", "--accent", "--info", "--warning", "--success", "--secondary"];
const getFamilleBadgeStyle = (codeFamille: string | null): React.CSSProperties => {
  if (!codeFamille) return { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", borderColor: "hsl(var(--border))" };
  let hash = 0;
  for (let i = 0; i < codeFamille.length; i++) hash = (hash * 31 + codeFamille.charCodeAt(i)) >>> 0;
  const token = FAMILLE_PALETTE[hash % FAMILLE_PALETTE.length];
  return { background: `hsl(var(${token}) / 0.12)`, color: `hsl(var(${token}))`, borderColor: `hsl(var(${token}) / 0.25)` };
};

interface Props {
  onNew: () => void;
  onEdit: (code: string) => void;
  onDuplicate: (code: string) => void;
}

const RubriquesList: React.FC<Props> = ({ onNew, onEdit, onDuplicate }) => {
  const [rubriques, setRubriques] = useState<Rubrique[]>([]);
  const [familles, setFamilles] = useState<Ref[]>([]);
  const [types, setTypes] = useState<Ref[]>([]);
  const [flux, setFlux] = useState<Ref[]>([]);
  const [frequences, setFrequences] = useState<Ref[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // RG-FILTER-MULTI-01 (Adil DAIA — 07/05/2026) : filtres multi-sélection
  const [filterFamille, setFilterFamille] = useState<string[]>([]);
  const [filterType, setFilterType] = useState<string[]>([]);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [imputations, setImputations] = useState<Imputation[]>([]);
  // Dépendances (pour le contrôle au glisser-déposer)
  const [alimentationsRub, setAlimentationsRub] = useState<AlimentationLite[]>([]);
  const [reglesSpecifiques, setReglesSpecifiques] = useState<RegleSpecifiqueLite[]>([]);
  const [contributeursAssiette, setContributeursAssiette] = useState<ContributeurAssietteLite[]>([]);
  const [composantesCotisation, setComposantesCotisation] = useState<ComposanteCotisationLite[]>([]);
  // Glisser-déposer
  const [dragCode, setDragCode] = useState<string | null>(null);
  const [dragOverCode, setDragOverCode] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    const [rRes, fRes, tRes, flRes, frRes, alRes, caRes, ccRes, rsRes] = await Promise.all([
      supabase.from("rubrique_paie" as never).select("*").order("code"),
      supabase.from("ref_famille_rubrique_paie" as never).select("code,libelle").eq("actif" as never, true as never),
      supabase.from("ref_type_rubrique_paie" as never).select("code,libelle").eq("actif" as never, true as never),
      supabase.from("ref_flux_rubrique_paie" as never).select("code,libelle").eq("actif" as never, true as never),
      supabase.from("ref_frequence_rubrique_paie" as never).select("code,libelle").eq("actif" as never, true as never),
      // RG-RUB-DEPENDANCES-01 : source de dépendance "codée en dur" dans le
      // paramétrage (alimentation d'un attribut par une autre rubrique).
      // Les composantes d'assiette (rubrique_paie_assiette) sont volontairement
      // exclues (RG-RUB-DEPENDANCES-03) : une assiette est recalculée à chaque
      // traitement, l'ordre_calcul n'a pas d'impact sur elle. On les recharge
      // néanmoins ici (RG-RUB-DEPENDANCES-04) pour EXPANSER toute référence à
      // une assiette vers ses vrais contributeurs — exactement comme le fait
      // _dependances() côté moteur (paie_engine.py).
      supabase.from("rubrique_paie_alimentation" as never).select("code_rubrique,source_type,rubrique_source"),
      supabase.from("rubrique_paie_assiette" as never).select("code_rubrique,code_assiette"),
      supabase.from("regle_calcul_cotisation_composante" as never)
        .select("code_rubrique_part_salariale,code_rubrique_part_patronale,code_rubrique_assiette")
        .eq("actif" as never, true as never),
      // + dépendances "libres" exprimées en [CODE] dans le texte d'une règle spécifique.
      supabase.from("regle_calcul_specifique" as never).select("code,instructions_text").eq("archive" as never, false as never),
    ]);
    if (rRes.data) setRubriques(rRes.data as Rubrique[]);
    if (fRes.data) setFamilles(fRes.data as Ref[]);
    if (tRes.data) setTypes(tRes.data as Ref[]);
    if (flRes.data) setFlux(flRes.data as Ref[]);
    if (frRes.data) setFrequences(frRes.data as Ref[]);
    if (alRes.data) setAlimentationsRub(alRes.data as AlimentationLite[]);
    if (caRes.data) setContributeursAssiette(caRes.data as ContributeurAssietteLite[]);
    if (ccRes.data) setComposantesCotisation(ccRes.data as ComposanteCotisationLite[]);
    if (rsRes.data) setReglesSpecifiques(rsRes.data as RegleSpecifiqueLite[]);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const loadImputations = async (code: string) => {
    const data = []; const error = null; // Supabase desactive
    setImputations((data || []) as Imputation[]);
  };

  const filtered = useMemo(() => {
    let list = rubriques;
    if (filterFamille.length > 0) list = list.filter(r => filterFamille.includes(r.code_famille));
    if (filterType.length > 0) list = list.filter(r => filterType.includes(r.code_type));
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(r => r.code.toLowerCase().includes(s) || r.libelle.toLowerCase().includes(s));
    }
    return list;
  }, [rubriques, filterFamille, filterType, search]);

  // RG-RUB-SORT-01 (Adil DAIA — 07/05/2026) : Tri tri-état au clic sur en-tête
  const { sortedData: sorted, toggleSort, SortIcon } = useTableSort(filtered, {
    getValue: (row, key) => (row as any)[key],
  });

  // RG-RUB-DEPENDANCES-01/04 : dependants[A] = ensemble des codes RÉELS (jamais
  // une assiette elle-même — cf. RG-RUB-DEPENDANCES-03) que A doit voir calculés
  // avant lui. Reproduit fidèlement _dependances() de paie_engine.py :
  //   a) alimentation d'un attribut par une AUTRE rubrique — si la source est
  //      une assiette, EXPANSÉE vers tous ses contributeurs réels
  //   b) références [CODE] dans le texte de la règle spécifique liée — même
  //      expansion si le CODE référencé est une assiette
  //   c) rubriques de type COT (cotisation) : dépendent des contributeurs de
  //      l'assiette de leurs composantes (regle_calcul_cotisation_composante)
  const dependances = useMemo(() => {
    const typeParCode = new Map(rubriques.map((r) => [r.code, r.code_type]));
    const estAssiette = (code: string) => typeParCode.get(code) === "ASS";

    const contributeursDe = new Map<string, Set<string>>();
    contributeursAssiette.forEach((c) => {
      if (!contributeursDe.has(c.code_assiette)) contributeursDe.set(c.code_assiette, new Set());
      contributeursDe.get(c.code_assiette)!.add(c.code_rubrique);
    });

    const deps = new Map<string, Set<string>>();
    // Ajoute soit le code directement, soit — s'il s'agit d'une assiette —
    // l'ensemble de ses contributeurs réels (jamais l'assiette elle-même).
    const ajoute = (code: string, dependDe: string) => {
      if (!code || !dependDe || code === dependDe) return;
      const cibles = estAssiette(dependDe) ? [...(contributeursDe.get(dependDe) || [])] : [dependDe];
      cibles.forEach((cible) => {
        if (!cible || cible === code) return;
        if (!deps.has(code)) deps.set(code, new Set());
        deps.get(code)!.add(cible);
      });
    };

    // (a) alimentation par une autre rubrique
    alimentationsRub.forEach((a) => {
      if (a.source_type === "RUBRIQUE" && a.rubrique_source) ajoute(a.code_rubrique, a.rubrique_source);
    });

    // (b) références [CODE] dans la règle spécifique liée (code_regle qui ne
    // pointe PAS vers une règle standard — pas de texte [CODE] à y parser)
    const instructionsParRegle = new Map(reglesSpecifiques.map((r) => [r.code, r.instructions_text || ""]));
    const reRub = /\[([A-Z0-9_]+)\]/g;
    rubriques.forEach((r) => {
      if (!r.code_regle) return;
      const texte = instructionsParRegle.get(r.code_regle);
      if (texte === undefined) return;
      let m: RegExpExecArray | null;
      reRub.lastIndex = 0;
      while ((m = reRub.exec(texte))) ajoute(r.code, m[1].toUpperCase());
    });

    // (c) rubriques COT : dépendent des contributeurs de l'assiette de leurs composantes
    composantesCotisation.forEach((c) => {
      if (!c.code_rubrique_assiette) return;
      [c.code_rubrique_part_salariale, c.code_rubrique_part_patronale].forEach((codeCot) => {
        if (codeCot && typeParCode.get(codeCot) === "COT") ajoute(codeCot, c.code_rubrique_assiette!);
      });
    });

    return deps;
  }, [alimentationsRub, contributeursAssiette, composantesCotisation, reglesSpecifiques, rubriques]);

  // dependants inverse : pour un code donné, qui a besoin que LUI soit calculé avant.
  const dependantsInverse = useMemo(() => {
    const inv = new Map<string, Set<string>>();
    dependances.forEach((set, code) => {
      set.forEach((dep) => {
        if (!inv.has(dep)) inv.set(dep, new Set());
        inv.get(dep)!.add(code);
      });
    });
    return inv;
  }, [dependances]);

  const refLabel = (refs: Ref[], code: string | null) => refs.find(r => r.code === code)?.libelle || code || "—";

  // RG-RUB-DEPENDANCES-02 (Adil DAIA) : l'alerte ne doit apparaître QUE si
  // l'ordre_calcul ACTUEL contredit une dépendance connue (pas dès qu'une
  // dépendance existe — la plupart sont déjà correctement ordonnées et n'ont
  // rien d'alarmant). Deux rubriques sans écart d'ordre défini (l'une des
  // deux à null) ne sont pas non plus signalées : rien à comparer.
  const problemesOrdre = useMemo(() => {
    const pb = new Map<string, string[]>();
    const rubriqueParCode = new Map(rubriques.map((r) => [r.code, r]));
    rubriques.forEach((r) => {
      if (r.ordre_calcul == null) return;
      const msgs: string[] = [];
      (dependances.get(r.code) || new Set()).forEach((dep) => {
        const d = rubriqueParCode.get(dep);
        if (d && d.ordre_calcul != null && d.ordre_calcul >= r.ordre_calcul!) {
          msgs.push(`Dépend de « ${dep} » (ordre ${d.ordre_calcul}) mais est calculée avant elle (ordre ${r.ordre_calcul})`);
        }
      });
      (dependantsInverse.get(r.code) || new Set()).forEach((dep) => {
        const d = rubriqueParCode.get(dep);
        if (d && d.ordre_calcul != null && d.ordre_calcul <= r.ordre_calcul!) {
          msgs.push(`« ${dep} » (ordre ${d.ordre_calcul}) en dépend mais est calculée avant elle (ordre ${r.ordre_calcul})`);
        }
      });
      if (msgs.length > 0) pb.set(r.code, msgs);
    });
    return pb;
  }, [rubriques, dependances, dependantsInverse]);


  const deleteRubrique = async (code: string) => {
    if (!confirm("Supprimer cette rubrique ?")) return;
    await supabase.from("rubrique_paie" as never).delete().eq("code" as never, code as never);
    loadAll();
  };

  // RG-RUB-DND-01 (Adil DAIA) : glisser une ligne et la déposer sur une autre
  // l'insère juste AVANT la cible, dans la liste actuellement affichée
  // (filtrée/triée) — cohérent visuellement quel que soit le tri en cours.
  const handleDrop = async (codeCible: string) => {
    const codeSource = dragCode;
    setDragCode(null); setDragOverCode(null);
    if (!codeSource || codeSource === codeCible) return;

    const idxCible = sorted.findIndex((r) => r.code === codeCible);
    if (idxCible === -1) return;
    // Borne supérieure = ordre de la cible ; borne inférieure = ordre de la
    // ligne juste au-dessus dans la liste affichée (en ignorant la source
    // elle-même si elle apparaît juste avant, pour ne pas se coincer contre soi-même).
    const voisinsAvant = sorted.slice(0, idxCible).filter((r) => r.code !== codeSource);
    const borneSup = sorted[idxCible].ordre_calcul;
    const borneInf = voisinsAvant.length ? voisinsAvant[voisinsAvant.length - 1].ordre_calcul : null;

    // --- Contrôle des dépendances (RG-RUB-DEPENDANCES-01) ---------------
    const messages: string[] = [];
    const rubriqueParCode = new Map(rubriques.map((r) => [r.code, r]));
    const nouvelOrdreProvisoire = borneInf != null && borneSup != null ? (borneInf + borneSup) / 2
      : borneSup != null ? borneSup - 1 : borneInf != null ? borneInf + 1 : 0;

    (dependances.get(codeSource) || new Set()).forEach((dep) => {
      const r = rubriqueParCode.get(dep);
      if (r && r.ordre_calcul != null && r.ordre_calcul >= nouvelOrdreProvisoire) {
        messages.push(`« ${codeSource} » a besoin de « ${dep} » (ordre ${r.ordre_calcul}), qui se retrouverait calculée APRÈS elle.`);
      }
    });
    (dependantsInverse.get(codeSource) || new Set()).forEach((dep) => {
      const r = rubriqueParCode.get(dep);
      if (r && r.ordre_calcul != null && r.ordre_calcul <= nouvelOrdreProvisoire) {
        messages.push(`« ${dep} » (ordre ${r.ordre_calcul}) a besoin de « ${codeSource} », qui se retrouverait calculée APRÈS elle.`);
      }
    });
    if (messages.length > 0) {
      const suite = confirm(
        `⚠ Ce nouvel ordre casse ${messages.length} dépendance(s) de calcul :\n\n${messages.join("\n")}\n\n` +
        `Déplacer quand même ? (à corriger ensuite manuellement, sans quoi le calcul de paie utilisera des valeurs non à jour)`
      );
      if (!suite) return;
    }

    setReordering(true);
    try {
      if (borneInf != null && borneSup != null && Math.floor((borneInf + borneSup) / 2) === borneInf) {
        // Pas de place entre les deux valeurs entières adjacentes (ex. 610/611) :
        // on fait de la place en renumérotant tout ce qui suit la cible (+10),
        // sur l'ENSEMBLE des rubriques (pas seulement celles affichées/filtrées).
        const aDecaler = rubriques.filter((r) => r.code !== codeSource && r.ordre_calcul != null && r.ordre_calcul >= borneSup);
        await Promise.all(aDecaler.map((r) =>
          supabase.from("rubrique_paie" as never).update({ ordre_calcul: (r.ordre_calcul as number) + 10 } as never).eq("code" as never, r.code as never)
        ));
        await supabase.from("rubrique_paie" as never).update({ ordre_calcul: borneInf + 5 } as never).eq("code" as never, codeSource as never);
      } else {
        await supabase.from("rubrique_paie" as never).update({ ordre_calcul: Math.round(nouvelOrdreProvisoire) } as never).eq("code" as never, codeSource as never);
      }
      await loadAll();
    } finally {
      setReordering(false);
    }
  };

  const toggleExpand = (code: string) => {
    if (expandedRow === code) { setExpandedRow(null); return; }
    setExpandedRow(code);
    loadImputations(code);
  };

  const exportExcel = () => {
    const data = filtered.map(r => ({
      Code: r.code, Libellé: r.libelle, "Lib. Édition": r.libelle_edition || "",
      Famille: refLabel(familles, r.code_famille), Type: refLabel(types, r.code_type),
      Flux: refLabel(flux, r.code_flux), Fréquence: refLabel(frequences, r.code_frequence),
      "Fréq. Calcul": FREQ_LABELS[r.frequence_calcul] || r.frequence_calcul,
      "Fréq. RAZ": FREQ_LABELS[r.frequence_raz_cumuls] || r.frequence_raz_cumuls,
      "Date début": r.date_debut || "", "Date fin": r.date_fin || "",
      Traiter: r.traiter ? "Oui" : "Non", Simulation: r.simulation ? "Oui" : "Non",
      "Ordre calcul": r.ordre_calcul ?? "", Règle: r.code_regle || "",
      Description: r.description || "", Archive: r.archive ? "Oui" : "Non",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rubriques Paie");
    XLSX.writeFile(wb, "rubriques_paie_export.xlsx");
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-accent/10">
            <Settings size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Rubriques de paie</h1>
            <p className="text-xs text-muted-foreground">Liste des rubriques, familles, types et imputations comptables</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportExcel}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
            <Download size={14} /> Exporter
          </button>
          <button onClick={onNew}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:bg-accent/90 transition-colors">
            <Plus size={14} /> Nouvelle rubrique
          </button>
        </div>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..."
            className="pl-9 pr-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border w-56" />
        </div>
        <MultiSelectFilter
          label="Familles"
          options={familles.map(f => ({ value: f.code, label: f.libelle }))}
          selected={filterFamille}
          onChange={setFilterFamille}
        />
        <MultiSelectFilter
          label="Types"
          options={types.map(t => ({ value: t.code, label: t.libelle }))}
          selected={filterType}
          onChange={setFilterType}
        />
        <span className="self-center text-xs text-muted-foreground">{filtered.length} rubrique(s)</span>
        <span className="self-center text-xs text-muted-foreground/70 flex items-center gap-1">
          <GripVertical size={11} /> Glissez une ligne pour changer son ordre de calcul
          {reordering && <Loader2 size={11} className="animate-spin ml-1" />}
        </span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-accent" />
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "hsl(var(--muted) / 0.5)" }} className="border-b border-border">
                <th className="px-2 py-3 w-6" title="Glisser pour réordonner" />
                <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground w-8" />
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("code")}>Code <SortIcon column="code" /></th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("libelle")}>Libellé <SortIcon column="libelle" /></th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("code_famille")}>Famille <SortIcon column="code_famille" /></th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("code_type")}>Type <SortIcon column="code_type" /></th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("code_flux")}>Flux <SortIcon column="code_flux" /></th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("code_frequence")}>Fréq. <SortIcon column="code_frequence" /></th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("ordre_calcul")}>Ordre <SortIcon column="ordre_calcul" /></th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("traiter")}>Traiter <SortIcon column="traiter" /></th>
                <th className="px-3 py-3 w-20" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <React.Fragment key={r.code}>
                  <tr
                    draggable
                    onDragStart={(e) => { setDragCode(r.code); e.dataTransfer.effectAllowed = "move"; }}
                    onDragOver={(e) => { e.preventDefault(); if (dragCode && dragCode !== r.code) setDragOverCode(r.code); }}
                    onDragLeave={() => setDragOverCode((c) => (c === r.code ? null : c))}
                    onDrop={(e) => { e.preventDefault(); handleDrop(r.code); }}
                    onDragEnd={() => { setDragCode(null); setDragOverCode(null); }}
                    className={`border-b cursor-pointer transition-colors hover:bg-muted/40 ${
                      dragOverCode === r.code ? "border-t-2 border-t-accent" : "border-border"
                    } ${dragCode === r.code ? "opacity-40" : ""}`}
                    onClick={() => {
                      setListNavigationContext("rubriques", sorted.map(x => x.code));
                      onEdit(r.code);
                    }}
                  >
                    <td className="px-2 py-3 cursor-grab active:cursor-grabbing" onClick={(e) => e.stopPropagation()} title="Glisser pour changer l'ordre de calcul">
                      <GripVertical size={13} className="text-muted-foreground/50" />
                    </td>
                    <td className="px-3 py-3" onClick={e => { e.stopPropagation(); toggleExpand(r.code); }}>
                      <button className="p-1 rounded hover:bg-muted">
                        {expandedRow === r.code ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />}
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-mono text-xs px-1.5 py-0.5 rounded border" style={getCodeColorStyle(r.code_type)}>
                        {r.code}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-medium text-foreground">{r.libelle}</td>
                    <td className="px-3 py-3">
                      {r.code_famille ? (
                        <span className="text-xs px-2 py-0.5 rounded-full border" style={getFamilleBadgeStyle(r.code_famille)}>
                          {refLabel(familles, r.code_famille)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {r.code_type ? (
                        <span className="text-xs px-2 py-0.5 rounded-full border" style={getTypeBadgeStyle(r.code_type)}>
                          {refLabel(types, r.code_type)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {r.code_flux ? (
                        <span className="text-xs px-2 py-0.5 rounded-full border" style={getFluxBadgeStyle(r.code_flux)}>
                          {refLabel(flux, r.code_flux)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{refLabel(frequences, r.code_frequence)}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        {r.ordre_calcul ?? "—"}
                        {(problemesOrdre.get(r.code)?.length || 0) > 0 && (
                          <span title={(problemesOrdre.get(r.code) || []).join(" · ")}>
                            <AlertTriangle size={10} className="text-destructive" />
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${!r.traiter ? "bg-muted text-muted-foreground" : ""}`}
                        style={r.traiter ? { background: "hsl(var(--success) / 0.12)", color: "hsl(var(--success))" } : undefined}
                      >
                        {r.traiter ? "Oui" : "Non"}
                      </span>
                    </td>
                    <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button onClick={() => {
                      setListNavigationContext("rubriques", sorted.map(x => x.code));
                      onEdit(r.code);
                    }} className="p-1.5 rounded hover:bg-muted transition-colors" title="Modifier">
                          <Pencil size={12} style={{ color: "hsl(var(--accent))" }} />
                        </button>
                        <button onClick={() => onDuplicate(r.code)} className="p-1.5 rounded hover:bg-muted transition-colors" title="Dupliquer">
                          <Copy size={12} style={{ color: "hsl(var(--info))" }} />
                        </button>
                        <button onClick={() => deleteRubrique(r.code)} className="p-1.5 rounded hover:bg-muted transition-colors" title="Supprimer">
                          <Trash2 size={12} className="text-destructive" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedRow === r.code && (
                    <tr className="bg-muted/10 border-b border-border" onClick={e => e.stopPropagation()}>
                      <td colSpan={11} className="px-6 py-4">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3">
                          <div><span className="text-xs text-muted-foreground">Lib. édition:</span> <span className="text-xs text-foreground font-medium ml-1">{r.libelle_edition || "—"}</span></div>
                          <div><span className="text-xs text-muted-foreground">Règle:</span> <span className="text-xs text-foreground font-medium ml-1">{r.code_regle || "—"}</span></div>
                          <div><span className="text-xs text-muted-foreground">Date début:</span> <span className="text-xs text-foreground font-medium ml-1">{r.date_debut || "—"}</span></div>
                          <div><span className="text-xs text-muted-foreground">Date fin:</span> <span className="text-xs text-foreground font-medium ml-1">{r.date_fin || "—"}</span></div>
                          <div><span className="text-xs text-muted-foreground">Fréq. calcul:</span> <span className="text-xs font-medium ml-1 px-1.5 py-0.5 rounded bg-accent/10 text-accent">{FREQ_LABELS[r.frequence_calcul] || r.frequence_calcul}</span></div>
                          <div><span className="text-xs text-muted-foreground">Fréq. RAZ:</span> <span className="text-xs font-medium ml-1 px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--warning) / 0.12)", color: "hsl(var(--warning))" }}>{FREQ_LABELS[r.frequence_raz_cumuls] || r.frequence_raz_cumuls}</span></div>
                        </div>
                        <div className="flex flex-wrap gap-2 mb-3">
                          {BOOL_FLAGS.map(({ key, label }) => (
                            <span key={key} className={`text-xs px-2 py-0.5 rounded-full ${r[key] ? "bg-accent/10 text-accent" : "bg-muted/50 text-muted-foreground"}`}>
                              {label}: {r[key] ? "✓" : "✗"}
                            </span>
                          ))}
                        </div>
                        {r.description && <p className="text-xs text-muted-foreground mb-3">{r.description}</p>}
                        <div>
                          <p className="text-xs font-semibold text-foreground mb-2">Imputations comptables</p>
                          {imputations.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Aucune imputation</p>
                          ) : (
                            <table className="text-xs border border-border rounded">
                              <thead>
                                <tr className="bg-muted/30">
                                  <th className="px-3 py-1 text-left text-muted-foreground">N°</th>
                                  <th className="px-3 py-1 text-left text-muted-foreground">Compte</th>
                                  <th className="px-3 py-1 text-left text-muted-foreground">Sens</th>
                                </tr>
                              </thead>
                              <tbody>
                                {imputations.map(imp => (
                                  <tr key={imp.numero_imputation} className="border-t border-border">
                                    <td className="px-3 py-1">{imp.numero_imputation}</td>
                                    <td className="px-3 py-1 font-mono">{imp.code_compte}</td>
                                    <td className="px-3 py-1">{imp.sens === "D" ? "Débit" : "Crédit"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Aucune rubrique trouvée
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default RubriquesList;
