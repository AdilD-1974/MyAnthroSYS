/**
 * RubriqueForm – Formulaire complet de création / modification d'une rubrique de paie.
 * Sections affichées en accordéon.
 */
import React, { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { ArrowLeft, Check, Loader2, Plus, Trash2, Info, FileText, Calculator, Layers, Receipt, Archive as ArchiveIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useListNavigationContext } from "@/hooks/useListNavigationContext";
import { ChevronLeft, ChevronRight, ChevronDown, RotateCcw } from "lucide-react";

interface Ref { code: string; libelle: string; ordre_calcul?: number | null }
interface Rubrique {
  code: string; libelle: string; libelle_edition: string | null; description: string | null;
  code_famille: string | null; code_flux: string | null; code_type: string | null; code_frequence: string | null;
  frequence_calcul: string; frequence_raz_cumuls: string;
  date_debut: string | null; date_fin: string | null;
  traiter: boolean; simulation: boolean; v_batch: boolean; v_externe: boolean; v_ajout: boolean;
  v_forcage: boolean; v_regularisation: boolean; v_annulation: boolean; v_reprise: boolean; v_import: boolean;
  v_glissant: boolean; v_historique: boolean; pr_cumulee: boolean;
  ordre_calcul: number | null; conditionnee: boolean; code_regle: string | null; archive: boolean;
  zone_fixe_key: string | null;
  // RG-RUB-ARRONDI-01 : nouveau champ de paramétrage — nécessite la
  // migration 048_rubrique_arrondi_stockage.sql avant usage.
  mode_arrondi: string; nb_decimales_arrondi: number;
  // RG-RUB-EDITION-COND-01 : n'enregistrer/afficher la ligne calculée que si
  // l'attribut sélectionné est différent de 0. null = toujours enregistrer.
  // ⚠️ Nécessite une colonne dédiée côté base — voir note de migration plus bas.
  attribut_controle_non_zero: string | null;
  // RG-RUB-EN-NET-01 : montant alimenté (EV MONTANT ou zone fixe) traité
  // comme un NET à garantir — le moteur recherche le brut équivalent par
  // dichotomie (voir sql/23_rubrique_en_net.sql).
  rubrique_en_net: boolean;
}
interface Imputation {
  id?: string; rubrique_paie_code: string; part: "SALARIALE" | "PATRONALE" | "NEUTRE";
  compte_debit: string | null; compte_credit: string | null;
  axe_debit: string | null; axe_credit: string | null;
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

const ATTRIBUTS_RUBRIQUE = ["BASE", "NOMBRE", "TAUX", "MONTANT", "DATE", "TEXTE"] as const;
const ATTRIBUTS_RUBRIQUE_LABELS: Record<string, string> = {
  BASE: "Base", NOMBRE: "Nombre", TAUX: "Taux", MONTANT: "Montant", DATE: "Date", TEXTE: "Texte",
};
// RG-RUB-EDITION-COND-01 : seuls les attributs numériques ont un sens dans un test "≠ 0".
const ATTRIBUTS_CONTROLE_NON_ZERO = ["BASE", "NOMBRE", "TAUX", "MONTANT"] as const;
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

// RG-RUB-ARRONDI-01 (Adil DAIA) : mode d'arrondi appliqué au résultat calculé
// de la rubrique. ⚠️ Champ de PARAMÉTRAGE uniquement dans ce formulaire — son
// application réelle lors du calcul de paie nécessite un câblage séparé dans
// paie_engine.py, non encore fait à ce stade.
const ARRONDI_MODES = [
  { code: "PLUS_PROCHE", label: "Au plus proche" },
  { code: "SUPERIEUR", label: "Toujours au supérieur" },
  { code: "INFERIEUR", label: "Toujours à l'inférieur (tronqué)" },
];

const EMPTY: Rubrique = {
  code: "", libelle: "", libelle_edition: null, description: null,
  code_famille: null, code_flux: null, code_type: null, code_frequence: null,
  frequence_calcul: "MENSUELLE", frequence_raz_cumuls: "ANNUELLE",
  date_debut: null, date_fin: null,
  traiter: true, simulation: false, v_batch: false, v_externe: false, v_ajout: false,
  v_forcage: false, v_regularisation: false, v_annulation: false, v_reprise: false, v_import: false,
  v_glissant: false, v_historique: false, pr_cumulee: false,
  ordre_calcul: null, conditionnee: false, code_regle: null, archive: false, zone_fixe_key: null,
  mode_arrondi: "PLUS_PROCHE", nb_decimales_arrondi: 2,
  attribut_controle_non_zero: null,
  rubrique_en_net: false,
};

const ZONE_FIXE_OPTIONS = Array.from({ length: 20 }, (_, i) => ({
  value: `zone_fixe_${String(i + 1).padStart(2, "0")}`,
  label: `Zone fixe ${String(i + 1).padStart(2, "0")}`,
}));

// Autorisations de saisie en ÉLÉMENT VARIABLE : une rubrique est saisissable
// dès qu'au moins un TYPE est coché. `v_import` autorise en plus l'alimentation
// par import de fichier (contrôlée à l'import).
const EV_TYPES: { key: keyof Rubrique; label: string; desc: string; code: string }[] = [
  { key: "v_ajout", label: "Ajout", desc: "S'ajoute à la valeur calculée", code: "AJOUT" },
  { key: "v_forcage", label: "Forçage", desc: "Remplace la valeur calculée", code: "FORCAGE" },
  { key: "v_regularisation", label: "Régularisation", desc: "Rappel sur période antérieure", code: "REGULARISATION" },
  { key: "v_annulation", label: "Annulation", desc: "Annule un élément précédent", code: "ANNULATION" },
  { key: "v_reprise", label: "Reprise", desc: "Reprise d'historique / bilan d'ouverture", code: "REPRISE" },
];

const BOOL_FLAGS: { key: keyof Rubrique; label: string; desc: string }[] = [
  { key: "v_batch", label: "Batch", desc: "Traitement par lot" },
  { key: "v_externe", label: "Externe", desc: "Valorisation externe" },
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

// Autocomplete générique utilisé pour les champs Compte débit/crédit (source
// ref_imputation_comptable) et Axe débit/crédit (source ref_axe_analytique)
// de l'onglet Comptabilité. `options` porte la valeur stockée (`value`,
// ex. code_compte ou code axe) et le libellé affiché.
function ComboboxRef({
  value, onChange, options, placeholder, width = "w-40",
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  width?: string;
}) {
  const [saisie, setSaisie] = useState("");
  const [ouvert, setOuvert] = useState(false);

  const selection = options.find(o => o.value === value);
  const texteAffiche = ouvert ? saisie : (selection ? `${selection.value} – ${selection.label}` : value);

  const filtres = options.filter(o =>
    !saisie || o.value.toLowerCase().includes(saisie.toLowerCase()) || o.label.toLowerCase().includes(saisie.toLowerCase())
  ).slice(0, 30);

  return (
    <div className={`relative ${width}`}>
      <input
        value={texteAffiche}
        onChange={e => { setSaisie(e.target.value); setOuvert(true); }}
        onFocus={() => { setSaisie(""); setOuvert(true); }}
        onBlur={() => setTimeout(() => setOuvert(false), 150)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
      />
      {ouvert && filtres.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-border bg-card shadow-lg">
          {filtres.map(o => (
            <li
              key={o.value}
              onMouseDown={() => { onChange(o.value); setSaisie(""); setOuvert(false); }}
              className="px-3 py-1.5 text-sm cursor-pointer hover:bg-muted"
            >
              <span className="font-mono">{o.value}</span>
              {o.label && <span className="text-muted-foreground"> – {o.label}</span>}
            </li>
          ))}
        </ul>
      )}
      {value && !ouvert && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-destructive text-xs"
          title="Effacer"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ---- Pavé accordéon maison — chevron à gauche (icône + libellé + badge
// optionnel à droite), même esprit que les panneaux pliables déjà utilisés
// ailleurs dans l'appli (HistoriqueCollaborateurPage, TraitementPaiePage). --
function PaveAccordeon({ titre, icone: Icone, extra, ouvert, onToggle, children }: {
  titre: string; icone?: React.ElementType; extra?: React.ReactNode;
  ouvert: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-5 py-4 text-left hover:bg-muted/30 transition-colors"
      >
        <ChevronDown
          size={16}
          className="shrink-0 text-muted-foreground transition-transform duration-200"
          style={{ transform: ouvert ? "rotate(0deg)" : "rotate(-90deg)" }}
        />
        {Icone && <Icone size={16} className="shrink-0 text-muted-foreground" />}
        <span className="text-sm font-semibold text-foreground flex-1">{titre}</span>
        {extra}
      </button>
      {ouvert && <div className="px-5 pb-5 pt-1 border-t border-border">{children}</div>}
    </div>
  );
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
  const [refAxes, setRefAxes] = useState<{ id: string; code: string; libelle: string }[]>([]);
  const [allRubriques, setAllRubriques] = useState<Ref[]>([]);
  const [reglesCatalogue, setReglesCatalogue] = useState<{ code: string; libelle: string; formule_lisible: string; attribut_calcule: string }[]>([]);
  const [reglesSpecifiques, setReglesSpecifiques] = useState<{ code: string; libelle: string; attribut_calcule: string }[]>([]);
  const [constantes, setConstantes] = useState<{ code: string; libelle: string; valeur: string }[]>([]);
  const [loading, setLoading] = useState(!!sourceCode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [newImp, setNewImp] = useState({
    compte_debit: "", compte_credit: "", axe_debit: "", axe_credit: "",
    part: "NEUTRE" as "SALARIALE" | "PATRONALE" | "NEUTRE",
  });
  const [newAss, setNewAss] = useState({ code_assiette: "", sens_assiette: "PLUS" });
  const [composantes, setComposantes] = useState<{ code_rubrique: string; libelle: string; sens_assiette: string }[]>([]);

  // RG-POPULATION-RUBRIQUE-01 (Adil DAIA) : populations attribuées à cette
  // rubrique (opt-in strict — sans aucune population ni déclencheur, la
  // rubrique n'est calculée pour personne) et cascade de déclencheurs.
  //
  // Chaque ligne de déclencheur porte un statut visible plutôt que de
  // disparaître immédiatement au clic sur "Retirer" — même principe que
  // l'attribution des rubriques dans PopulationsPaiePage.tsx : ATTRIBUEE
  // (déjà en base), RETIREE (sera retirée à l'enregistrement, annulable),
  // NOUVELLE (pas encore enregistrée).
  const [populationsDisponibles, setPopulationsDisponibles] = useState<{ id: string; code: string; libelle: string; actif: boolean }[]>([]);
  const [populationsRubrique, setPopulationsRubrique] = useState<{ population_id: string; type_attribution: "ATTRIBUEE" | "RETIREE" }[]>([]);
  const [lignesDeclencheurs, setLignesDeclencheurs] = useState<{ code: string; statut: "ATTRIBUEE" | "RETIREE" | "NOUVELLE" }[]>([]);
  const [chargementPopulations, setChargementPopulations] = useState(false);
  const [enregistrementPopulations, setEnregistrementPopulations] = useState(false);

  useEffect(() => {
    setChargementPopulations(true);
    api.get("/paie/populations")
      .then((rows: any) => setPopulationsDisponibles(rows || []))
      .catch(() => { /* repli silencieux : le pavé affichera juste "aucune population" */ })
      .finally(() => setChargementPopulations(false));
  }, []);

  useEffect(() => {
    if (!editCode) { setPopulationsRubrique([]); setLignesDeclencheurs([]); return; }
    Promise.all([
      api.get(`/paie/rubriques/${editCode}/populations`),
      api.get(`/paie/rubriques/${editCode}/declencheurs`),
    ]).then(([pops, decls]: [any, any]) => {
      setPopulationsRubrique(pops || []);
      setLignesDeclencheurs((decls || []).map((code: string) => ({ code, statut: "ATTRIBUEE" as const })));
    }).catch(() => { /* repli silencieux */ });
  }, [editCode]);

  const basculerRetraitDeclencheur = (code: string) => {
    setLignesDeclencheurs((lignes) => lignes
      .filter((l) => !(l.code === code && l.statut === "NOUVELLE"))
      .map((l) => l.code === code ? { ...l, statut: l.statut === "RETIREE" ? "ATTRIBUEE" : "RETIREE" } : l));
  };

  const ajouterDeclencheur = (code: string) => {
    setLignesDeclencheurs((lignes) => {
      if (lignes.some((l) => l.code === code)) {
        return lignes.map((l) => l.code === code ? { ...l, statut: "ATTRIBUEE" as const } : l);
      }
      return [...lignes, { code, statut: "NOUVELLE" as const }];
    });
  };

  const enregistrerPopulations = async () => {
    if (!editCode) return;
    setEnregistrementPopulations(true);
    try {
      const codesRetenus = lignesDeclencheurs.filter((l) => l.statut !== "RETIREE").map((l) => l.code);
      await api.patch(`/paie/rubriques/${editCode}/declencheurs`, { codes_declencheurs: codesRetenus });
      setLignesDeclencheurs(codesRetenus.map((code) => ({ code, statut: "ATTRIBUEE" as const })));
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: any) {
      setError(e.message || "Échec de l'enregistrement des déclencheurs");
    } finally {
      setEnregistrementPopulations(false);
    }
  };

  // RG-RUB-ONGLETS-01 (Adil DAIA) : navigation par onglets (au lieu de
  // l'accordéon précédent) — persistée en localStorage comme avant, même clé
  // renommée pour éviter de restaurer une ancienne valeur incompatible.
  const TAB_STORAGE_KEY = "rubrique_form_active_tab";
  const getStoredTab = (): string => {
    try { return localStorage.getItem(TAB_STORAGE_KEY) || "general"; } catch { return "general"; }
  };
  const [activeTab, setActiveTabRaw] = useState<string>(getStoredTab);
  const setActiveTab = useCallback((v: string) => {
    setActiveTabRaw(v);
    try { localStorage.setItem(TAB_STORAGE_KEY, v); } catch {}
  }, []);

  // Filet de sécurité : si l'onglet mémorisé n'est plus disponible dans le
  // contexte courant (ex. "comptabilite" alors qu'on crée une nouvelle
  // rubrique, ou "calcul" alors que le type vient de passer à Assiette),
  // on retombe sur "Général" plutôt que d'afficher un panneau vide.
  useEffect(() => {
    const dispo = new Set(["general"]);
    if (form.code_type !== "ASS") dispo.add("calcul");
    if (!isNew) { dispo.add("assiette"); dispo.add("comptabilite"); }
    if (!dispo.has(activeTab)) setActiveTabRaw("general");
  }, [activeTab, isNew, form.code_type]);

  // RG-RUB-ONGLETS-03 (Adil DAIA) : l'onglet "Calcul" est désormais un
  // accordéon à un seul niveau (voir plus bas) — l'ancien état de sous-onglet
  // Alimentation/Calcul n'a plus lieu d'être.
  // Pavés ouverts par défaut : Alimentation + Règle de calcul (l'essentiel).
  // Accordéon maison plutôt que le composant shadcn générique — on veut le
  // chevron à GAUCHE de l'icône/libellé (convention déjà utilisée ailleurs
  // dans l'appli), alors que le composant shadcn le place par défaut à droite.
  const [pavesOuverts, setPavesOuverts] = useState<Set<string>>(new Set(["alimentation", "regle", "classification"]));
  const togglePave = (cle: string) => setPavesOuverts(prev => {
    const n = new Set(prev);
    n.has(cle) ? n.delete(cle) : n.add(cle);
    return n;
  });

  useEffect(() => {
    const loadRefs = async () => {
      const [fam, typ, flx, frq, assRub, cpt, axe, allRub, cst, reg, spec] = await Promise.all([
        api.get("/db/ref_famille_rubrique_paie?actif=eq.true&select=code,libelle"),
        api.get("/db/ref_type_rubrique_paie?actif=eq.true&select=code,libelle"),
        api.get("/db/ref_flux_rubrique_paie?actif=eq.true&select=code,libelle"),
        api.get("/db/ref_frequence_rubrique_paie?actif=eq.true&select=code,libelle"),
        // RG-RUB-ASS-01 : Seules les rubriques de type ASS peuvent recevoir des composantes – Auteur : Adil DAIA
        api.get("/db/rubrique_paie?code_type=eq.ASS&select=code,libelle&order=code"),
        api.get("/db/ref_imputation_comptable?actif=eq.true&select=id,code_compte,intitule_compte&order=code_compte"),
        api.get("/db/ref_axe_analytique?actif=eq.true&select=id,code,libelle&order=code"),
        api.get("/db/rubrique_paie?select=code,libelle,ordre_calcul&order=code"),
        api.get("/db/ref_constante_paie?actif=eq.true&select=code,libelle,valeur&order=code"),
        api.get("/db/ref_regle_calcul_standard?actif=eq.true&select=code,libelle,formule_lisible,attribut_calcule&order=ordre_affichage"),
        api.get("/db/regle_calcul_specifique?actif=eq.true&archive=eq.false&select=code,libelle,attribut_calcule&order=code"),
      ]);
      if (fam) setFamilles(fam as Ref[]);
      if (typ) setTypes(typ as Ref[]);
      if (flx) setFlux(flx as Ref[]);
      if (frq) setFrequences(frq as Ref[]);
      if (assRub) setAssietteRubriques(assRub as Ref[]);
      if (cpt) setRefComptes(cpt as any[]);
      if (axe) setRefAxes(axe as any[]);
      if (allRub) setAllRubriques(allRub as Ref[]);
      if (cst) setConstantes(cst as any[]);
      if (reg) setReglesCatalogue(reg as any[]);
      if (spec) setReglesSpecifiques(spec as any[]);
    };
    loadRefs();
  }, []);

  useEffect(() => {
    if (!sourceCode) return;
    const load = async () => {
      setLoading(true);
      const [rData, iData, aData, alData] = await Promise.all([
        api.get(`/db/rubrique_paie?code=eq.${sourceCode}&limit=1`),
        api.get(`/db/rubrique_paie_imputation?rubrique_paie_code=eq.${sourceCode}&order=part`),
        api.get(`/db/rubrique_paie_assiette?code_rubrique=eq.${sourceCode}`),
        api.get(`/db/rubrique_paie_alimentation?code_rubrique=eq.${sourceCode}`),
      ]);
      const rRes = { data: (rData as any[])?.[0] };
      const iRes = { data: iData }; const aRes = { data: aData }; const alRes2 = { data: alData };
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
      if (alRes2.data) setAlimentations(alRes2.data as Alimentation[]);
      setLoading(false);
    };
    load();
  }, [sourceCode]);

  // RG-RUB-ASS-01 : Chargement des rubriques qui alimentent cette assiette
  useEffect(() => {
    const code = editCode || (form.code && form.code_type === "ASS" ? form.code : null);
    if (!code || form.code_type !== "ASS") { setComposantes([]); return; }
    const load = async () => {
      try {
        // Récupère toutes les lignes assiette pointant vers ce code
        const rows: any = await api.get(`/db/rubrique_paie_assiette?code_assiette=eq.${code}&select=code_rubrique,sens_assiette`);
        if (!rows || (rows as any[]).length === 0) { setComposantes([]); return; }
        // Enrichit avec les libellés depuis allRubriques (déjà chargé) ou rappel API
        let libMap: Record<string, string> = {};
        if (allRubriques && allRubriques.length > 0) {
          allRubriques.forEach((r: any) => { libMap[r.code] = r.libelle; });
        } else {
          const allR: any = await api.get("/db/rubrique_paie?select=code,libelle,ordre_calcul&order=code");
          (allR || []).forEach((r: any) => { libMap[r.code] = r.libelle; });
        }
        setComposantes((rows as any[]).map((d: any) => ({
          code_rubrique: d.code_rubrique,
          libelle: libMap[d.code_rubrique] || d.code_rubrique,
          sens_assiette: d.sens_assiette,
        })));
      } catch (e) { setComposantes([]); }
    };
    load();
  }, [editCode, form.code, form.code_type, allRubriques]);

  // RG-EV-AUTORISATION : la rubrique est saisissable en élément variable dès
  // qu'au moins un type est autorisé. Sans type autorisé, l'import est impossible.
  const evSaisissable = EV_TYPES.some((t) => !!(form as any)[t.key]);

  const setField = (key: string, value: any) => setForm(f => {
    const next: any = { ...f, [key]: value };
    // Décocher le dernier type de saisie retire aussi l'autorisation d'import.
    if (EV_TYPES.some((t) => t.key === key) && !EV_TYPES.some((t) => !!next[t.key])) {
      next.v_import = false;
    }
    return next;
  });

  const handleSave = async () => {
    if (!form.code || !form.libelle) { setError("Code et libellé sont requis."); return; }
    setSaving(true); setError(null); setSuccess(false);
    const newCode = form.code.toUpperCase();

    if (isNew) {
      try {
        await api.post("/db/rubrique_paie", { ...form, code: newCode });
      } catch (e: any) { setError(e.message?.includes("duplicate") ? "Ce code existe déjà." : (e.message || "Erreur")); setSaving(false); return; }

      // En mode duplication, cloner les données liées (imputations, assiettes, alimentations)
      if (duplicateCode) {
        for (const imp of imputations) {
          await api.post("/db/rubrique_paie_imputation", {
            rubrique_paie_code: newCode, part: imp.part,
            compte_debit: imp.compte_debit, compte_credit: imp.compte_credit,
            axe_debit: imp.axe_debit, axe_credit: imp.axe_credit,
          }).catch(() => {});
        }
        for (const ass of assiettes) {
          await api.post("/db/rubrique_paie_assiette", { code_rubrique: newCode, code_assiette: ass.code_assiette, sens_assiette: ass.sens_assiette }).catch(() => {});
        }
        for (const al of alimentations) {
          const { id, ...rest } = al as any;
          await api.post("/db/rubrique_paie_alimentation", { ...rest, code_rubrique: newCode }).catch(() => {});
        }
      }
    } else {
      const { code, ...rest } = form;
      try {
        await api.patch(`/db/rubrique_paie?code=eq.${editCode}`, rest);
      } catch (e: any) { setError((e as any).message || "Erreur"); setSaving(false); return; }
    }


    setSaving(false);
    setSuccess(true);
    setTimeout(() => setSuccess(false), 2000);
    if (isNew) onBack();
  };

  const addImputation = async () => {
    if (!newImp.compte_debit && !newImp.compte_credit) {
      setError("Au moins un compte (débit ou crédit) est requis.");
      return;
    }
    const codeRub = editCode || form.code.toUpperCase();
    if (!codeRub) { setError("Enregistrez d'abord la rubrique."); return; }
    try {
      await api.post("/db/rubrique_paie_imputation", {
        rubrique_paie_code: codeRub, part: newImp.part,
        compte_debit: newImp.compte_debit || null, compte_credit: newImp.compte_credit || null,
        axe_debit: newImp.axe_debit || null, axe_credit: newImp.axe_credit || null,
      });
    } catch (e: any) { setError(e.message); return; }
    const impData: any = await api.get(`/db/rubrique_paie_imputation?rubrique_paie_code=eq.${codeRub}&order=part`);
    setImputations((impData || []) as any[]);
    setNewImp({ compte_debit: "", compte_credit: "", axe_debit: "", axe_credit: "", part: "NEUTRE" });
  };

  const deleteImputation = async (id: string) => {
    await api.delete(`/db/rubrique_paie_imputation?id=eq.${id}`);
    setImputations(prev => prev.filter(i => i.id !== id));
  };

  const addAssiette = async () => {
    if (!newAss.code_assiette) return;
    const codeRub = editCode || form.code.toUpperCase();
    if (!codeRub) { setError("Enregistrez d'abord la rubrique."); return; }
    try {
      await api.post("/db/rubrique_paie_assiette", { code_rubrique: codeRub, code_assiette: newAss.code_assiette, sens_assiette: newAss.sens_assiette });
    } catch (e: any) { setError(e.message?.includes("duplicate") ? "Cette assiette est déjà associée." : (e.message || "Erreur")); return; }
    const assData: any = await api.get(`/db/rubrique_paie_assiette?code_rubrique=eq.${codeRub}`);
    setAssiettes((assData || []) as Assiette[]);
    setNewAss({ code_assiette: "", sens_assiette: "PLUS" });
  };

  const deleteAssiette = async (id: string) => {
    await api.delete(`/db/rubrique_paie_assiette?id=eq.${id}`);
    setAssiettes(prev => prev.filter(a => a.id !== id));
  };

  const assietteLabel = (code: string) => assietteRubriques.find(r => r.code === code)?.libelle || code;

  const getAlimentation = (attr: string) => alimentations.find(a => a.code_attribut === attr);

  const saveAlimentation = async (attr: string, field: string, value: any) => {
    const codeRub = editCode || form.code.toUpperCase();
    if (!codeRub) { setError("Enregistrez d'abord la rubrique."); return; }
    const existing = getAlimentation(attr);
    if (existing?.id) {
      await api.patch(`/db/rubrique_paie_alimentation?id=eq.${existing.id}`, { [field]: value });
      setAlimentations(prev => prev.map(a => a.code_attribut === attr ? { ...a, [field]: value } : a));
    } else {
      const newRow: any = { code_rubrique: codeRub, code_attribut: attr, [field]: value };
      try {
        const inserted: any = await api.post("/db/rubrique_paie_alimentation", newRow);
        if (inserted) setAlimentations(prev => [...prev, (Array.isArray(inserted) ? inserted[0] : inserted) as Alimentation]);
      } catch (e: any) { setError(e.message); return; }
    }
    // Miroir : alimenter le Nombre alimente aussi la Base, pour toujours
    // conserver la base initiale (la Base reste modifiable indépendamment).
    if (attr === "NOMBRE") {
      await saveAlimentation("BASE", field, value);
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
              {duplicateCode ? (
                `Duplication de ${duplicateCode}`
              ) : isNew ? (
                "Nouvelle rubrique de paie"
              ) : (
                <>
                  {form.libelle || editCode}{" "}
                  <span className="text-accent">({editCode})</span>
                </>
              )}
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
        <div
          className="mb-4 px-4 py-3 rounded-lg text-sm"
          style={{ background: "hsl(var(--success) / 0.1)", color: "hsl(var(--success))", border: "1px solid hsl(var(--success) / 0.3)" }}
        >
          Rubrique enregistrée avec succès.
        </div>
      )}

      {/* Formulaire en onglets */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full justify-start bg-muted/50 mb-4 h-auto flex-wrap">
          <TabsTrigger value="general" className="gap-1.5 text-sm py-2.5"><FileText size={15} /> Général</TabsTrigger>
          {form.code_type !== "ASS" && (
            <TabsTrigger value="calcul" className="gap-1.5 text-sm py-2.5"><Calculator size={15} /> Calcul</TabsTrigger>
          )}
          {!isNew && (
            <TabsTrigger value="assiette" className="gap-1.5 text-sm py-2.5"><Layers size={15} /> Assiette</TabsTrigger>
          )}
          {!isNew && (
            <TabsTrigger value="comptabilite" className="gap-1.5 text-sm py-2.5"><Receipt size={15} /> Comptabilité</TabsTrigger>
          )}
        </TabsList>

        {/* ===== Onglet Général : Informations générales + Classification + Archivage ===== */}
        <TabsContent value="general" className="space-y-4 mt-0">
        <div className="rounded-xl border border-border bg-card px-5 py-4">
          <h3 className="text-sm font-semibold text-foreground mb-4">
            Informations générales
          </h3>
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
        </div>

        <PaveAccordeon titre="Classification & Fréquences" ouvert={pavesOuverts.has("classification")} onToggle={() => togglePave("classification")}>
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

            {/* RG-RUB-EN-NET-01 (Adil DAIA) : montant EV/zone fixe traité
                comme un NET à garantir — le moteur cherche le brut
                équivalent par dichotomie (calculer_bulletin). C'est une
                caractéristique fondamentale de la rubrique (comment
                interpréter sa valeur, quelle que soit sa source), pas une
                question d'autorisation de saisie — d'où sa place ici plutôt
                que dans l'onglet Calcul. Mis en avant (fond warning) : un
                paramétrage à ne pas cocher par inadvertance, il recalcule
                le bulletin entier plusieurs fois. */}
            <div className="border-t border-border pt-4 mt-4">
              <label
                className="flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors"
                style={
                  form.rubrique_en_net
                    ? { borderColor: "hsl(var(--warning) / 0.5)", background: "hsl(var(--warning) / 0.06)" }
                    : { borderColor: "hsl(var(--border))" }
                }
                title="Le montant alimenté (élément variable ou zone fixe) est interprété comme un net à garantir ; le système recherche le brut équivalent"
              >
                <input type="checkbox" checked={!!form.rubrique_en_net}
                  onChange={e => setField("rubrique_en_net", e.target.checked)}
                  className="mt-0.5 rounded border-border focus:ring-2" style={{ accentColor: "hsl(var(--warning))" }} />
                <div>
                  <span className="text-sm font-medium text-foreground">Rubrique en net</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Le montant reçu (élément variable ou zone fixe) est un <strong>net à garantir</strong>, pas le
                    montant final. Le système recherche automatiquement le brut équivalent (recalcul complet du
                    bulletin par approximations successives) selon le paramétrage habituel de cette rubrique
                    (cotisations, IR…).
                  </p>
                </div>
              </label>
            </div>
        </PaveAccordeon>

        {/* RG-POPULATION-RUBRIQUE-01 (Adil DAIA) : uniquement une fois la
            rubrique créée (les tables d'attribution référencent son code). */}
        {!isNew && (
        <PaveAccordeon titre="Populations & accès" ouvert={pavesOuverts.has("populations")} onToggle={() => togglePave("populations")}>
          <p className="text-xs text-muted-foreground mb-4">
            Sans aucune population ni déclencheur ci-dessous, cette rubrique n'est calculée pour <strong>personne</strong>.
          </p>

          {/* Lecture seule — l'attribution se fait depuis la population elle-même
              (Paramétrage > Populations de paie), pas ici : une rubrique peut
              appartenir à plusieurs populations, et la gérer depuis la fiche
              rubrique risquait de la retirer par erreur d'une population à
              laquelle une autre personne l'avait rattachée entre-temps.
              RG-POPULATION-RUBRIQUE-04 : une population peut aussi bien
              ATTRIBUER cette rubrique que la RETIRER explicitement — les deux
              sont distinguées par couleur (vert/rouge), pas juste listées
              pêle-mêle, sinon on ne voit pas d'où vient un éventuel retrait. */}
          <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
            Populations qui incluent cette rubrique
          </h4>
          {chargementPopulations ? (
            <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : populationsRubrique.length === 0 ? (
            <p className="text-xs text-muted-foreground italic mb-4">
              Aucune — cette rubrique n'apparaît dans aucune population pour l'instant.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {populationsRubrique.map(pr => {
                  const p = populationsDisponibles.find(x => x.id === pr.population_id);
                  if (!p) return null;
                  const attribuee = pr.type_attribution === "ATTRIBUEE";
                  return (
                    <span key={p.id}
                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border"
                      style={
                        attribuee
                          ? { borderColor: "hsl(var(--success) / 0.35)", background: "hsl(var(--success) / 0.08)", color: "hsl(var(--success))" }
                          : { borderColor: "hsl(var(--destructive) / 0.35)", background: "hsl(var(--destructive) / 0.08)", color: "hsl(var(--destructive))" }
                      }
                      title={p.actif ? undefined : "Population inactive"}
                    >
                      {attribuee ? <Check size={11} /> : <Trash2 size={11} />}
                      {p.libelle}{!p.actif && " (inactive)"}
                    </span>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground mb-4">
                <span className="inline-flex items-center gap-1" style={{ color: "hsl(var(--success))" }}><Check size={10} /> attribue</span>
                {" · "}
                <span className="inline-flex items-center gap-1" style={{ color: "hsl(var(--destructive))" }}><Trash2 size={10} /> retire</span>
                {" — en cas de conflit entre deux populations, le retrait prime toujours."}
              </p>
            </>
          )}
          <p className="text-xs text-muted-foreground mb-5">
            Pour ajouter, retirer ou changer le type (attribuer/retirer) de cette rubrique dans une population, modifiez la
            population dans <span className="font-medium text-foreground">Paramétrage &gt; Populations de paie</span>.
          </p>

          <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
            Déclencheurs (accès en cascade)
          </h4>
          <p className="text-xs text-muted-foreground mb-3">
            Avoir déjà accès à l'une de ces rubriques suffit à débloquer celle-ci, même sans population qui lui soit propre.
            Seules les rubriques d'ordre de calcul <strong>supérieur</strong> à celui de cette rubrique ({form.ordre_calcul ?? 0}) sont proposées.
          </p>

          <div className="rounded-lg border border-border overflow-hidden mb-3">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "hsl(var(--muted) / 0.5)" }}>
                  <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">Rubrique déclencheur</th>
                  <th className="px-3 py-2 text-right text-[11px] uppercase tracking-wide font-semibold text-muted-foreground w-24">Ordre</th>
                  <th className="px-3 py-2 text-center text-[11px] uppercase tracking-wide font-semibold text-muted-foreground w-28">Statut</th>
                  <th className="px-3 py-2 w-12" />
                </tr>
              </thead>
              <tbody>
                {lignesDeclencheurs.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-3 text-center text-xs text-muted-foreground italic">Aucun déclencheur.</td></tr>
                )}
                {lignesDeclencheurs.map(ligne => {
                  const r = allRubriques.find(x => x.code === ligne.code);
                  const cfg = ligne.statut === "ATTRIBUEE"
                    ? { label: "Attribuée", v: "--success" }
                    : ligne.statut === "RETIREE"
                      ? { label: "Retirée", v: "--destructive" }
                      : { label: "Nouvelle", v: "--info" };
                  return (
                    <tr key={ligne.code} className="border-t border-border">
                      <td className="px-3 py-1.5">
                        <span className={`font-mono text-xs ${ligne.statut === "RETIREE" ? "line-through text-muted-foreground" : "text-accent"}`}>{ligne.code}</span>
                        {r?.libelle && <span className={`text-muted-foreground ${ligne.statut === "RETIREE" ? "line-through" : ""}`}> – {r.libelle}</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs text-muted-foreground">{r?.ordre_calcul ?? "—"}</td>
                      <td className="px-3 py-1.5 text-center">
                        <span
                          className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                          style={{ background: `hsl(var(${cfg.v}) / 0.12)`, color: `hsl(var(${cfg.v}))` }}
                        >
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <button onClick={() => basculerRetraitDeclencheur(ligne.code)}
                          className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
                          style={ligne.statut === "RETIREE" ? { color: "hsl(var(--success))" } : undefined}
                          onMouseEnter={(e) => { if (ligne.statut !== "RETIREE") e.currentTarget.style.color = "hsl(var(--destructive))"; }}
                          onMouseLeave={(e) => { if (ligne.statut !== "RETIREE") e.currentTarget.style.color = ""; }}
                          title={ligne.statut === "RETIREE" ? "Annuler le retrait" : "Retirer"}
                        >
                          {ligne.statut === "RETIREE" ? <RotateCcw size={12} /> : <Trash2 size={12} />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <select
            value=""
            onChange={e => { if (e.target.value) ajouterDeclencheur(e.target.value); }}
            className="w-full sm:w-96 px-3 py-2 rounded-lg border text-sm bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all mb-4"
          >
            <option value="">+ Ajouter un déclencheur…</option>
            {allRubriques
              .filter(r => r.code !== (editCode || form.code)
                && !lignesDeclencheurs.some(l => l.code === r.code && l.statut !== "RETIREE")
                && (r.ordre_calcul ?? 0) > (form.ordre_calcul ?? 0))
              .map(r => <option key={r.code} value={r.code}>{r.code} – {r.libelle} (ordre {r.ordre_calcul ?? 0})</option>)}
          </select>

          <div>
            <button onClick={enregistrerPopulations} disabled={enregistrementPopulations}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50">
              {enregistrementPopulations ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Enregistrer les déclencheurs
            </button>
          </div>
        </PaveAccordeon>
        )}


        {/* Archivage — déplacé ici (RG-RUB-ONGLETS-01) : un simple bouton bascule
            ne justifiait pas son propre onglet, regroupé avec le reste des
            informations générales de la rubrique. */}
        <PaveAccordeon titre="Archivage" icone={ArchiveIcon} ouvert={pavesOuverts.has("archivage")} onToggle={() => togglePave("archivage")}>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={form.archive} onChange={e => setField("archive", e.target.checked)}
              className="rounded border-border text-accent focus:ring-accent/30" />
            <div>
              <span className="text-sm font-medium text-foreground">Archiver cette rubrique</span>
              <p className="text-xs text-muted-foreground">La rubrique ne sera plus visible dans les listes actives</p>
            </div>
          </label>
        </PaveAccordeon>
        </TabsContent>

        {/* ===== Onglet Calcul : pavés en accordéon (RG-RUB-ONGLETS-03 — Adil DAIA) =====
            Remplace l'ancienne structure à 3 niveaux (Calcul > Alimentation/Calcul >
            Normale/Cotisation/Barème) : Alimentation et Règle de calcul se cachaient
            mutuellement alors qu'on a besoin de voir les deux à la fois (la règle
            référence justement les valeurs alimentées). Un seul niveau, en accordéon,
            scroll au lieu de clics entre onglets. Panneaux "Règle cotisation" et
            "Recherche barème" retirés : aucun de leurs champs n'était relié à `form`
            ni sauvegardé nulle part (UI décorative, jamais câblée) — à réintroduire
            plus tard avec un vrai câblage plutôt que de laisser croire qu'ils fonctionnent. */}
        {form.code_type !== "ASS" && (
        <TabsContent value="calcul" className="mt-0 space-y-3">

          <PaveAccordeon titre="Alimentation des rubriques" ouvert={pavesOuverts.has("alimentation")} onToggle={() => togglePave("alimentation")}>
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
            </PaveAccordeon>

          <PaveAccordeon titre="Ordre & règle de calcul" ouvert={pavesOuverts.has("regle")} onToggle={() => togglePave("regle")}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="w-28">
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Ordre</label>
                <input type="number"
                  value={form.ordre_calcul ?? ""}
                  onChange={e => setField("ordre_calcul", e.target.value ? parseInt(e.target.value) : null)}
                  className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wider">Règle de calcul</label>
                <div className="rounded-lg border border-border bg-background p-4 space-y-3">
                  <div className="flex items-start gap-2 mb-2">
                    <Info size={14} className="text-muted-foreground mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground">Choisissez le type de règle (Standard = catalogue système, Spécifique = bibliothèque métier), puis la règle à appliquer. Ses variables (base, taux, nombre…) sont valorisées dans « Alimentation des rubriques » ci-dessus.</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Type de règle</label>
                      <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs">
                        {([["STANDARD", "Standard"], ["SPECIFIQUE", "Spécifique"]] as const).map(([val, lbl]) => {
                          const actif = (form.type_regle === "SPECIFIQUE" ? "SPECIFIQUE" : "STANDARD") === val;
                          return (
                            <button key={val} type="button"
                              onClick={() => { if (form.type_regle !== val) { setField("type_regle", val); setField("code_regle", null); } }}
                              className={`px-4 py-1.5 transition-colors ${actif ? "bg-accent text-accent-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}>
                              {lbl}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium mb-1.5 text-muted-foreground">
                        {form.type_regle === "SPECIFIQUE" ? "Règle spécifique (bibliothèque métier)" : "Règle de calcul (catalogue standard)"}
                      </label>
                      <select
                        value={form.code_regle || ""}
                        onChange={e => setField("code_regle", e.target.value || null)}
                        className="w-full px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                      >
                        <option value="">— Aucune règle —</option>
                        {form.type_regle === "SPECIFIQUE"
                          ? reglesSpecifiques.map(r => <option key={r.code} value={r.code}>{r.code} — {r.libelle}</option>)
                          : Object.entries(
                              reglesCatalogue.reduce((acc, r) => { (acc[r.attribut_calcule] ||= []).push(r); return acc; }, {} as Record<string, typeof reglesCatalogue>)
                            ).map(([attr, regs]) => (
                              <optgroup key={attr} label={`Calculs sur ${attr}`}>
                                {regs.map(r => <option key={r.code} value={r.code}>{r.code} — {r.libelle}</option>)}
                              </optgroup>
                            ))}
                      </select>
                      {form.code_regle && form.type_regle !== "SPECIFIQUE" && (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          Formule : <code className="text-accent">{reglesCatalogue.find(r => r.code === form.code_regle)?.formule_lisible || "—"}</code>
                        </p>
                      )}
                      {form.code_regle && form.type_regle === "SPECIFIQUE" && (
                        <p className="mt-1.5 text-xs text-muted-foreground">Règle métier personnalisée (séquence d'instructions définie dans « Règles de calcul »).</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            </PaveAccordeon>

          <PaveAccordeon
            titre="Autorisations de saisie & indicateurs"
            ouvert={pavesOuverts.has("autorisations")}
            onToggle={() => togglePave("autorisations")}
            extra={
              evSaisissable ? (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--success) / 0.15)", color: "hsl(var(--success))" }}>
                  Saisissable en élément variable
                </span>
              ) : (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  Non saisissable
                </span>
              )
            }
          >
            <p className="text-xs text-muted-foreground mb-3">
              Cochez les types autorisés. Dès qu'un seul type est coché, la rubrique devient saisissable en élément variable.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {EV_TYPES.map(({ key, label, desc }) => (
                <label key={key}
                  className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors bg-background ${
                    form[key] ? "border-accent/60 bg-accent/5" : "border-border hover:border-accent/30"}`}
                  title={desc}
                >
                  <input type="checkbox" checked={!!form[key]}
                    onChange={e => setField(key, e.target.checked)}
                    className="mt-0.5 rounded border-border text-accent focus:ring-accent/30" />
                  <div>
                    <span className="text-sm font-medium text-foreground">{label}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                  </div>
                </label>
              ))}
            </div>

            {/* Import : conditionné à au moins un type autorisé */}
            <label
              className={`mt-3 flex items-start gap-2.5 p-3 rounded-lg border transition-colors ${
                !evSaisissable ? "opacity-50 cursor-not-allowed border-border"
                : form.v_import ? "border-accent/60 bg-accent/5 cursor-pointer" : "border-border hover:border-accent/30 cursor-pointer bg-background"}`}
              title="Autorise l'alimentation de cette rubrique par import de fichier"
            >
              <input type="checkbox" checked={!!form.v_import} disabled={!evSaisissable}
                onChange={e => setField("v_import", e.target.checked)}
                className="mt-0.5 rounded border-border text-accent focus:ring-accent/30 disabled:cursor-not-allowed" />
              <div>
                <span className="text-sm font-medium text-foreground">Import autorisé</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  La rubrique peut être alimentée par import de fichier (Préparation → Import Excel).
                  {!evSaisissable && " Autorisez d'abord au moins un type de saisie."}
                </p>
              </div>
            </label>

            <h3 className="text-xs font-semibold text-muted-foreground mt-5 mb-3 uppercase tracking-wider">Indicateurs de traitement</h3>
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
            </PaveAccordeon>

          <PaveAccordeon titre="Arrondi & condition d'enregistrement" ouvert={pavesOuverts.has("arrondi")} onToggle={() => togglePave("arrondi")}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* RG-RUB-ARRONDI-01 : arrondi du résultat calculé */}
              <div>
                <p className="text-xs text-muted-foreground mb-3">
                  Mode et précision d'arrondi appliqués au montant calculé de cette rubrique.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Mode d'arrondi</label>
                    <select value={form.mode_arrondi} onChange={e => setField("mode_arrondi", e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all">
                      {ARRONDI_MODES.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Nombre de décimales</label>
                    <input type="number" min={0} max={6}
                      value={form.nb_decimales_arrondi}
                      onChange={e => setField("nb_decimales_arrondi", e.target.value === "" ? 0 : parseInt(e.target.value, 10))}
                      className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all" />
                  </div>
                </div>
              </div>

              {/* RG-RUB-EDITION-COND-01 (Adil DAIA) : n'enregistrer la ligne calculée que
                  si l'attribut choisi est différent de 0. ⚠️ Nécessite une colonne dédiée
                  côté base (voir migration suggérée en tête de fichier / doc de déploiement) —
                  paramétrage seul ici tant que paie_engine.py ne l'applique pas. */}
              <div>
                <p className="text-xs text-muted-foreground mb-3">
                  N'enregistre (et n'affiche) la ligne calculée que si l'attribut sélectionné est différent de 0.
                </p>
                <div>
                  <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Attribut à contrôler</label>
                  <select
                    value={form.attribut_controle_non_zero ?? ""}
                    onChange={e => setField("attribut_controle_non_zero", e.target.value || null)}
                    className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                  >
                    <option value="">— Aucun (toujours enregistrer) —</option>
                    {ATTRIBUTS_CONTROLE_NON_ZERO.map(a => (
                      <option key={a} value={a}>{ATTRIBUTS_RUBRIQUE_LABELS[a]}</option>
                    ))}
                  </select>
                  {form.attribut_controle_non_zero && (
                    <p className="text-xs text-muted-foreground mt-2">
                      La rubrique ne sera enregistrée que si{" "}
                      <span className="font-medium text-foreground">
                        {ATTRIBUTS_RUBRIQUE_LABELS[form.attribut_controle_non_zero]}
                      </span>{" "}
                      ≠ 0.
                    </p>
                  )}
                </div>
              </div>
            </div>
            </PaveAccordeon>

        </TabsContent>
        )}

        {/* ===== Onglet Assiette : Composantes (si type=ASS) ou Assiettes associées (sinon) ===== */}
        {!isNew && (
        <TabsContent value="assiette" className="space-y-4 mt-0">
        {/* RG-RUB-ASS-03 (Adil DAIA) : Pour les rubriques de type Assiette, afficher
            uniquement la liste des rubriques qui l'alimentent (composantes).
            Les pavés "Alimentation" et "Paramètres de calcul" sont masqués. */}
        {form.code_type === "ASS" && (
          <div className="rounded-xl border-2 px-5 py-4"
            style={{ borderColor: "hsl(var(--accent)/0.4)", background: "hsl(var(--accent)/0.04)" }}>
            <div className="flex items-center gap-2 mb-4">
                <span className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                  📋 Rubriques composantes de cette assiette
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                  style={{ background: composantes.length > 0 ? "hsl(var(--accent)/0.15)" : "hsl(var(--muted)/0.5)", color: composantes.length > 0 ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))" }}>
                  {composantes.length} rubrique{composantes.length > 1 ? "s" : ""}
                </span>
            </div>
              {/* Résumé : total +/- */}
              {composantes.length > 0 && (
                <div className="flex gap-4 mb-4 p-3 rounded-lg" style={{ background: "hsl(var(--muted)/0.3)" }}>
                  <div className="text-xs">
                    <span className="font-semibold" style={{ color: "hsl(var(--success))" }}>
                      + {composantes.filter(c => c.sens_assiette === "PLUS").length} en plus
                    </span>
                  </div>
                  <div className="text-xs">
                    <span className="font-semibold" style={{ color: "hsl(var(--destructive))" }}>
                      − {composantes.filter(c => c.sens_assiette !== "PLUS").length} en moins
                    </span>
                  </div>
                </div>
              )}
              <p className="text-xs mb-4" style={{ color: "hsl(var(--muted-foreground))" }}>
                Ces rubriques injectent leur valeur dans le calcul de cette assiette.
              </p>
              {composantes.length === 0 ? (
                <div className="flex items-center gap-2 text-sm italic py-6 justify-center" style={{ color: "hsl(var(--muted-foreground))" }}>
                  <Info size={14} />
                  Aucune rubrique ne référence cette assiette pour le moment.
                </div>
              ) : (
                <div className="rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: "hsl(var(--muted)/0.3)" }}>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>Code rubrique</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>Libellé</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>Sens dans l'assiette</th>
                      </tr>
                    </thead>
                    <tbody>
                      {composantes.map((c, idx) => (
                        <tr key={c.code_rubrique} className="border-t" style={{ borderColor: "hsl(var(--border))", background: idx % 2 === 0 ? "transparent" : "hsl(var(--muted)/0.15)" }}>
                          <td className="px-4 py-2.5 font-mono text-xs" style={{ color: "hsl(var(--foreground))" }}>{c.code_rubrique}</td>
                          <td className="px-4 py-2.5 text-sm" style={{ color: "hsl(var(--foreground))" }}>{c.libelle}</td>
                          <td className="px-4 py-2.5">
                            {c.sens_assiette === "PLUS" ? (
                              <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold"
                                style={{ background: "hsl(var(--success) / 0.12)", color: "hsl(var(--success))", border: "1px solid hsl(var(--success) / 0.25)" }}>
                                + En plus
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold"
                                style={{ background: "hsl(var(--destructive) / 0.12)", color: "hsl(var(--destructive))", border: "1px solid hsl(var(--destructive) / 0.25)" }}>
                                − En moins
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        )}

        {/* RG-RUB-ASS-02 : À l'exception des assiettes (ASS), toutes les autres rubriques peuvent être injectées dans les assiettes – Auteur : Adil DAIA */}
        {form.code_type !== "ASS" && (
          <div className="rounded-xl border border-border bg-card px-5 py-4">
            <h3 className="text-sm font-semibold text-foreground mb-4">
              Assiettes
            </h3>
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
                            <span
                              className="text-xs px-2 py-0.5 rounded-full"
                              style={
                                a.sens_assiette === "PLUS"
                                  ? { background: "hsl(var(--success) / 0.12)", color: "hsl(var(--success))" }
                                  : { background: "hsl(var(--destructive) / 0.12)", color: "hsl(var(--destructive))" }
                              }
                            >
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
          </div>
        )}
        </TabsContent>
        )}

        {/* ===== Onglet Comptabilité : Imputations comptables ===== */}
        {!isNew && (
        <TabsContent value="comptabilite" className="space-y-4 mt-0">
          <div className="rounded-xl border border-border bg-card px-5 py-4">
            <h3 className="text-sm font-semibold text-foreground mb-4">
              Imputations comptables
            </h3>
              {/* Options d'autocomplete : comptes depuis ref_imputation_comptable,
                  axes depuis ref_axe_analytique + le littéral spécial HERITE_UO
                  (reprend l'UO du collaborateur au moment de la génération —
                  ce n'est pas une ligne du référentiel). */}
              {(() => {
                const optionsComptes = refComptes.map(c => ({ value: c.code_compte, label: c.intitule_compte || "" }));
                const optionsAxes = [
                  { value: "HERITE_UO", label: "Hérité de l'UO du collaborateur" },
                  ...refAxes.map(a => ({ value: a.code, label: a.libelle })),
                ];
                const libelleCompte = (code: string | null) =>
                  code ? (refComptes.find(c => c.code_compte === code)?.intitule_compte || null) : null;
                const libelleAxe = (code: string | null) =>
                  code === "HERITE_UO" ? "Hérité de l'UO du collaborateur"
                  : code ? (refAxes.find(a => a.code === code)?.libelle || null) : null;

                return (
                  <>
                    {form.code_type === "COT" && imputations.length > 0 && (
                      ["SALARIALE", "PATRONALE"] as const
                    ).filter(p => !imputations.some((i: any) => i.part === p)).map(p => (
                      <p
                        key={p}
                        className="mb-3 text-xs px-3 py-2 rounded-lg"
                        style={{ background: "hsl(var(--warning) / 0.12)", color: "hsl(var(--warning))" }}
                      >
                        Part {p === "SALARIALE" ? "salariale" : "patronale"} non imputée — le montant correspondant sera exclu de la génération d'écritures.
                      </p>
                    ))}
                    {imputations.length > 0 && (
                      <div className="rounded-lg border border-border overflow-hidden mb-4">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-muted/30">
                              {form.code_type === "COT" && <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground">Part</th>}
                              <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground">Compte débit</th>
                              <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground">Compte crédit</th>
                              <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground">Axe débit</th>
                              <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground">Axe crédit</th>
                              <th className="px-4 py-2 w-12" />
                            </tr>
                          </thead>
                          <tbody>
                            {imputations.map((imp: any) => (
                              <tr key={imp.id} className="border-t border-border">
                                {form.code_type === "COT" && (
                                  <td className="px-4 py-2.5 text-foreground">
                                    {imp.part === "SALARIALE" ? "Salariale" : imp.part === "PATRONALE" ? "Patronale" : "—"}
                                  </td>
                                )}
                                <td className="px-4 py-2.5 text-foreground">
                                  {imp.compte_debit
                                    ? <><span className="font-mono">{imp.compte_debit}</span>{libelleCompte(imp.compte_debit) && <span className="text-muted-foreground"> – {libelleCompte(imp.compte_debit)}</span>}</>
                                    : "—"}
                                </td>
                                <td className="px-4 py-2.5 text-foreground">
                                  {imp.compte_credit
                                    ? <><span className="font-mono">{imp.compte_credit}</span>{libelleCompte(imp.compte_credit) && <span className="text-muted-foreground"> – {libelleCompte(imp.compte_credit)}</span>}</>
                                    : "—"}
                                </td>
                                <td className="px-4 py-2.5 text-foreground">
                                  {imp.axe_debit
                                    ? <><span className="font-mono">{imp.axe_debit}</span>{libelleAxe(imp.axe_debit) && <span className="text-muted-foreground"> – {libelleAxe(imp.axe_debit)}</span>}</>
                                    : "—"}
                                </td>
                                <td className="px-4 py-2.5 text-foreground">
                                  {imp.axe_credit
                                    ? <><span className="font-mono">{imp.axe_credit}</span>{libelleAxe(imp.axe_credit) && <span className="text-muted-foreground"> – {libelleAxe(imp.axe_credit)}</span>}</>
                                    : "—"}
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
                      {form.code_type === "COT" && (
                        <div>
                          <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Part</label>
                          <select value={newImp.part} onChange={e => setNewImp(p => ({ ...p, part: e.target.value as any }))}
                            className="px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all">
                            <option value="SALARIALE">Part salariale</option>
                            <option value="PATRONALE">Part patronale</option>
                          </select>
                        </div>
                      )}
                      <div>
                        <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Compte débit</label>
                        <ComboboxRef value={newImp.compte_debit} onChange={v => setNewImp(p => ({ ...p, compte_debit: v }))}
                          options={optionsComptes} placeholder="Rechercher un compte…" width="w-56" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Compte crédit</label>
                        <ComboboxRef value={newImp.compte_credit} onChange={v => setNewImp(p => ({ ...p, compte_credit: v }))}
                          options={optionsComptes} placeholder="Rechercher un compte…" width="w-56" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Axe débit</label>
                        <ComboboxRef value={newImp.axe_debit} onChange={v => setNewImp(p => ({ ...p, axe_debit: v }))}
                          options={optionsAxes} placeholder="Rechercher un axe…" width="w-48" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Axe crédit</label>
                        <ComboboxRef value={newImp.axe_credit} onChange={v => setNewImp(p => ({ ...p, axe_credit: v }))}
                          options={optionsAxes} placeholder="Rechercher un axe…" width="w-48" />
                      </div>
                      <button onClick={addImputation}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
                        <Plus size={13} /> Ajouter
                      </button>
                    </div>
                  </>
                );
              })()}
          </div>
        </TabsContent>
        )}
      </Tabs>

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
