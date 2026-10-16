import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, db, API_BASE, tokenStore } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, FileText,
  Layers, Loader2, Palette, Send,
} from "lucide-react";

// ── Types (miroir de app/schemas/etat.py) ───────────────────────────────────

interface TypeSourceEtat {
  code: string;
  libelle: string;
  contexte_requis: string[];
  actif: boolean;
}

interface ChampDisponible {
  champ_code: string;
  libelle: string;
  mode_donnee_defaut: "PERIODE" | "ACTUEL";
}

interface EcranLancementOut {
  code_ecran: string;
  libelle: string;
  contexte_disponible: string[];
  chemin_route: string | null;
  actif: boolean;
}

interface OptionMetadonnee {
  code: string;
  libelle: string;
}

interface EtatMetadonnees {
  statuts: OptionMetadonnee[];
  visibilites: OptionMetadonnee[];
  formats_sortie: OptionMetadonnee[];
  modes_donnee: OptionMetadonnee[];
}

interface ChampSelectionne extends ChampDisponible {
  visible: boolean;
  mode_donnee: "PERIODE" | "ACTUEL";
}

interface EtatDefinitionDetail {
  id: string;
  code: string;
  nom: string;
  description: string | null;
  type_source: string;
  modele_code: string | null;
  afficher_logo: boolean;
  pied_de_page_html: string | null;
  format_sortie: string;
  visibilite: string;
  statut: string;
  champs: { champ_code: string; visible: boolean; ordre_affichage: number; mode_donnee: "PERIODE" | "ACTUEL" }[];
  ecrans: string[];
}

interface RubriquePaieOption {
  code: string;
  libelle: string;
}

type AttributRubrique = "NOMBRE" | "BASE" | "MONTANT" | "MONTANT_PATRONAL" | "TAUX";

const LIBELLE_ATTRIBUT: Record<AttributRubrique, string> = {
  NOMBRE: "Nombre",
  BASE: "Base",
  MONTANT: "Montant",
  MONTANT_PATRONAL: "Montant patronal",
  TAUX: "Taux",
};

const ATTRIBUTS_RUBRIQUE: AttributRubrique[] = ["NOMBRE", "BASE", "MONTANT", "MONTANT_PATRONAL", "TAUX"];

const FORMATS_COLONNE = [
  { code: "MONTANT_2DEC", libelle: "Montant (2 décimales)" },
  { code: "NOMBRE_ENTIER", libelle: "Nombre entier" },
  { code: "NOMBRE_DECIMAL", libelle: "Nombre décimal" },
  { code: "POURCENTAGE", libelle: "Pourcentage" },
  { code: "TEXTE", libelle: "Texte" },
  { code: "DATE", libelle: "Date" },
] as const;

interface CorpsColonneLocal {
  code_colonne: string;
  libelle: string;
  format: string;
}

interface CorpsRubriqueMappingLocal {
  attribut: AttributRubrique;
  code_colonne: string;
}

interface CorpsRubriqueLocal {
  rubrique_paie_code: string;
  libelle: string; // libellé par défaut de la rubrique, affiché en placeholder
  libelle_personnalise: string; // "" = utiliser le libellé par défaut
  mappings: CorpsRubriqueMappingLocal[];
}

interface CorpsLigneSpecialeLocal {
  code_constante: string;
  libelle: string;
  code_colonne: string; // "" = non mappée
}

type PositionLibelleBloc = "DEBUT" | "FIN" | "AUCUN";
type PositionTotalBloc = "HAUT" | "BAS" | "AUCUN";

interface BlocLocal {
  id?: string; // absent = pas encore persisté côté serveur
  bloc_code: string;
  libelle: string;
  ordre_affichage: number;
  visible: boolean;
  couleur_fond: string;
  couleur_texte: string;
  police: string;
  taille_police: number | "";
  gras: boolean;
  position_libelle: PositionLibelleBloc;
  position_total: PositionTotalBloc;
  rubriques: string[]; // rubrique_paie_code du corps parent
  colonnesTotal: string[]; // code_colonne du corps parent
}

interface CorpsLocal {
  id?: string; // absent = pas encore persisté côté serveur
  corps_code: string;
  libelle: string;
  ordre_affichage: number;
  visible: boolean;
  couleur_fond: string;
  couleur_texte: string;
  police: string;
  taille_police: number | "";
  gras: boolean;
  colonnes: CorpsColonneLocal[];
  rubriques: CorpsRubriqueLocal[];
  lignesSpeciales: CorpsLigneSpecialeLocal[];
  blocs: BlocLocal[];
}

function coderCode(libelle: string, prefixe: string): string {
  return (
    libelle
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || `${prefixe}_${Date.now()}`
  );
}

const VARIABLES_PIED_DE_PAGE = [

  "{societe_nom}", "{periode}", "{numero_page}", "{total_pages}", "{date_generation}",
];

const ETAPES = [
  { n: 1, label: "Source", icon: Layers },
  { n: 2, label: "Champs", icon: Check },
  { n: 3, label: "Blocs", icon: Layers },
  { n: 4, label: "Mise en forme", icon: Palette },
  { n: 5, label: "Diffusion", icon: Send },
] as const;

// ── Page ─────────────────────────────────────────────────────────────────────

// Petit formulaire local (libellé + format) pour ajouter une colonne à un
// corps -- composant séparé pour isoler son propre état de saisie sans
// polluer l'état global du corps parent à chaque frappe.
function FormulaireNouvelleColonne({ onAjouter }: { onAjouter: (libelle: string, format: string) => void }) {
  const [libelle, setLibelle] = useState("");
  const [format, setFormat] = useState("MONTANT_2DEC");

  const valider = () => {
    if (!libelle.trim()) return;
    onAjouter(libelle.trim(), format);
    setLibelle("");
  };

  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={libelle}
        onChange={(e) => setLibelle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); valider(); } }}
        placeholder="Nom de la colonne (ex. Gains)"
        className="text-xs h-8 w-52"
      />
      <select
        value={format}
        onChange={(e) => setFormat(e.target.value)}
        className="text-xs rounded border px-1.5 py-1.5 h-8"
        style={{ borderColor: "hsl(var(--border))", background: "transparent" }}
      >
        {FORMATS_COLONNE.map((f) => (
          <option key={f.code} value={f.code}>{f.libelle}</option>
        ))}
      </select>
      <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={valider}>
        Ajouter
      </Button>
    </div>
  );
}

// Sélecteur de rubriques avec filtre et sélection multiple -- remplace le
// menu déroulant natif, ingérable dès que le référentiel de rubriques
// dépasse une dizaine d'entrées (cas réel : plusieurs dizaines).
function SelecteurRubriques({
  options,
  dejaAjoutees,
  onAjouter,
}: {
  options: RubriquePaieOption[];
  dejaAjoutees: Set<string>;
  onAjouter: (codes: string[]) => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [selection, setSelection] = useState<Set<string>>(new Set());

  const disponibles = options.filter((o) => !dejaAjoutees.has(o.code));
  const terme = recherche.trim().toLowerCase();
  const filtrees = terme
    ? disponibles.filter((o) => o.libelle.toLowerCase().includes(terme) || o.code.toLowerCase().includes(terme))
    : disponibles;

  const toggle = (code: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  };

  const toutSelectionner = () => setSelection(new Set(filtrees.map((o) => o.code)));

  const fermer = () => {
    setOuvert(false);
    setSelection(new Set());
    setRecherche("");
  };

  const valider = () => {
    onAjouter(Array.from(selection));
    fermer();
  };

  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className="text-xs px-3 py-1.5 rounded-full border"
        style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--primary))" }}
      >
        + Ajouter des rubriques…
      </button>
    );
  }

  return (
    <div className="rounded-lg border p-2 w-80" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))" }}>
      <Input
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
        placeholder="Filtrer par nom ou code…"
        className="text-xs h-8 mb-1.5"
        autoFocus
      />
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
          {filtrees.length} rubrique(s)
        </span>
        {filtrees.length > 0 && (
          <button type="button" onClick={toutSelectionner} className="text-[11px]" style={{ color: "hsl(var(--primary))" }}>
            Tout sélectionner
          </button>
        )}
      </div>
      <div className="max-h-48 overflow-auto space-y-0.5 mb-2 rounded border" style={{ borderColor: "hsl(var(--border))" }}>
        {filtrees.length === 0 ? (
          <p className="text-xs py-3 text-center" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune rubrique.</p>
        ) : (
          filtrees.map((o) => (
            <label
              key={o.code}
              className="flex items-center gap-2 text-xs px-2 py-1.5 cursor-pointer hover:bg-accent/10"
              style={{ color: "hsl(var(--foreground))" }}
            >
              <input type="checkbox" checked={selection.has(o.code)} onChange={() => toggle(o.code)} />
              {o.libelle}
            </label>
          ))
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>{selection.size} sélectionnée(s)</span>
        <div className="flex gap-1.5">
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={fermer}>Annuler</Button>
          <Button type="button" size="sm" className="h-7 text-xs" disabled={selection.size === 0} onClick={valider}>
            Ajouter ({selection.size})
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function EtatNouveauPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const enEdition = !!id;
  const { role } = useAuth();
  const estAdmin = role === "administrateur";
  const pieddepageRef = useRef<HTMLTextAreaElement>(null);
  const [prefillFait, setPrefillFait] = useState(false);
  const [ecransOriginaux, setEcransOriginaux] = useState<Set<string>>(new Set());

  const [etape, setEtape] = useState(1);
  const [soumission, setSoumission] = useState(false);
  const [collabApercu, setCollabApercu] = useState(""); // id du collaborateur retenu pour l'aperçu
  const [periodeApercu, setPeriodeApercu] = useState(""); // periode_id retenu pour l'aperçu
  const [generationApercu, setGenerationApercu] = useState(false);
  const [rechercheCollab, setRechercheCollab] = useState("");
  const [collabSelectionne, setCollabSelectionne] = useState<{ id: string; matricule: string; nom: string; prenom: string } | null>(null);
  const [bulletinSelectionneId, setBulletinSelectionneId] = useState("");

  // Étape 1 — Source
  const [code, setCode] = useState("");
  const [nom, setNom] = useState("");
  const [description, setDescription] = useState("");
  const [typeSource, setTypeSource] = useState<string | null>(null);

  // Étape 2 — Champs
  const [champs, setChamps] = useState<ChampSelectionne[]>([]);

  // Étape 3 (conditionnelle, BULLETIN uniquement) — Corps
  const [corpsListe, setCorpsListe] = useState<CorpsLocal[]>([]);
  const [corpsSupprimes, setCorpsSupprimes] = useState<string[]>([]);
  const [corpsPrefillFait, setCorpsPrefillFait] = useState(false);

  // Étape 3 — Mise en forme
  const [afficherLogo, setAfficherLogo] = useState(true);
  const [piedDePage, setPiedDePage] = useState("");
  const [formatSortie, setFormatSortie] = useState("PDF");
  const [modeleCode, setModeleCode] = useState("");

  // Étape 4 — Diffusion
  const [visibilite, setVisibilite] = useState("PRIVE");
  const [ecransSelectionnes, setEcransSelectionnes] = useState<Set<string>>(new Set());

  // ── Chargement des référentiels ──────────────────────────────────────────

  const { data: typesSource, isLoading: chargementSources } = useQuery({
    queryKey: ["etats-types-source"],
    queryFn: async () => (await api.get("/etats/types-source")) as TypeSourceEtat[],
  });

  const { data: metadonnees } = useQuery({
    queryKey: ["etats-metadonnees"],
    queryFn: async () => (await api.get("/etats/metadonnees")) as EtatMetadonnees,
    staleTime: Infinity,
  });

  interface ModeleEtatOption { code: string; libelle: string; type_source_compatible: string[]; actif: boolean }

  const { data: modelesDisponibles } = useQuery({
    queryKey: ["etats-modeles", typeSource],
    queryFn: async () => (await api.get(`/etats/modeles?type_source=${typeSource}`)) as ModeleEtatOption[],
    enabled: !!typeSource,
  });

  const { data: ecrans } = useQuery({
    queryKey: ["ecrans-lancement"],
    queryFn: async () => (await api.get("/ecrans")) as EcranLancementOut[],
  });

  const { data: champsDisponibles, isFetching: chargementChamps } = useQuery({
    queryKey: ["etats-champs-disponibles", typeSource],
    queryFn: async () =>
      (await api.get(`/etats/champs-disponibles?type_source=${typeSource}`)) as ChampDisponible[],
    enabled: !!typeSource,
  });

  const { data: etatExistant, isLoading: chargementEtat } = useQuery({
    queryKey: ["etat-detail", id],
    queryFn: async () => (await api.get(`/etats/${id}`)) as EtatDefinitionDetail,
    enabled: enEdition,
  });

  // Pré-remplissage : attend que l'état existant ET les champs disponibles
  // pour sa source soient chargés, pour pouvoir résoudre les libellés
  // (l'état ne stocke que des champ_code, pas leurs libellés).
  useEffect(() => {
    if (!enEdition || prefillFait || !etatExistant) return;
    setCode(etatExistant.code);
    setNom(etatExistant.nom);
    setDescription(etatExistant.description || "");
    setTypeSource(etatExistant.type_source);
    setAfficherLogo(etatExistant.afficher_logo);
    setPiedDePage(etatExistant.pied_de_page_html || "");
    setFormatSortie(etatExistant.format_sortie);
    setModeleCode(etatExistant.modele_code || "");
    setVisibilite(etatExistant.visibilite);
    setEcransSelectionnes(new Set(etatExistant.ecrans));
    setEcransOriginaux(new Set(etatExistant.ecrans));
    setPrefillFait(true);
  }, [enEdition, prefillFait, etatExistant]);

  // Fusionne la sélection déjà enregistrée avec les champs disponibles pour
  // la source (un champ ajouté depuis à la table de référence apparaît en
  // "non coché" par défaut ; l'ordre enregistré est respecté pour le reste).
  useEffect(() => {
    if (!champsDisponibles) return;
    if (enEdition && etatExistant && !prefillFait) return; // attend le pré-remplissage
    if (enEdition && etatExistant) {
      const parCode = new Map(etatExistant.champs.map((c) => [c.champ_code, c]));
      const selection: ChampSelectionne[] = champsDisponibles.map((c) => {
        const sauve = parCode.get(c.champ_code);
        return {
          ...c,
          visible: sauve ? sauve.visible : true,
          mode_donnee: sauve ? sauve.mode_donnee : c.mode_donnee_defaut,
        };
      });
      selection.sort((a, b) => {
        const oa = parCode.get(a.champ_code)?.ordre_affichage ?? 999;
        const ob = parCode.get(b.champ_code)?.ordre_affichage ?? 999;
        return oa - ob;
      });
      setChamps(selection);
      return;
    }
    setChamps(
      champsDisponibles.map((c) => ({
        ...c,
        visible: true,
        mode_donnee: c.mode_donnee_defaut,
      }))
    );
  }, [champsDisponibles, enEdition, etatExistant, prefillFait]);

  const sourceChoisie = useMemo(
    () => (typesSource || []).find((s) => s.code === typeSource) || null,
    [typesSource, typeSource]
  );

  // ── Actions étape 2 (champs) ─────────────────────────────────────────────

  const toggleChampVisible = (champ_code: string) => {
    setChamps((prev) =>
      prev.map((c) => (c.champ_code === champ_code ? { ...c, visible: !c.visible } : c))
    );
  };

  const toggleChampMode = (champ_code: string) => {
    setChamps((prev) =>
      prev.map((c) =>
        c.champ_code === champ_code
          ? { ...c, mode_donnee: c.mode_donnee === "PERIODE" ? "ACTUEL" : "PERIODE" }
          : c
      )
    );
  };

  const deplacerChamp = (index: number, direction: -1 | 1) => {
    setChamps((prev) => {
      const next = [...prev];
      const cible = index + direction;
      if (cible < 0 || cible >= next.length) return prev;
      [next[index], next[cible]] = [next[cible], next[index]];
      return next;
    });
  };

  // ── Étape 3 : Corps (BULLETIN uniquement) ────────────────────────────────

  const { data: rubriquesDisponibles } = useQuery({
    queryKey: ["rubriques-paie-actives"],
    queryFn: async () =>
      (await db.list("rubrique_paie", {
        select: "code,libelle",
        order: "libelle",
        archive: false,
        traiter: true,
      })) as RubriquePaieOption[],
    enabled: typeSource === "BULLETIN",
  });

  interface CorpsApiDetail {
    id: string;
    corps_code: string;
    libelle: string;
    ordre_affichage: number;
    visible: boolean;
    couleur_fond: string | null;
    couleur_texte: string | null;
    police: string | null;
    taille_police: number | null;
    gras: boolean;
    colonnes: { code_colonne: string; libelle: string; format: string }[];
    rubriques: { rubrique_paie_code: string; libelle: string | null; libelle_personnalise: string | null; mappings: { attribut: AttributRubrique; code_colonne: string }[] }[];
    lignes_speciales: { code_constante: string; libelle: string; code_colonne: string | null }[];
  }

  // Chargement des corps existants en édition (une seule fois, une fois la
  // source connue -- inutile pour les sources autres que BULLETIN)
  const { data: corpsExistants } = useQuery({
    queryKey: ["etat-corps", id],
    queryFn: async () => (await api.get(`/etats/${id}/corps`)) as CorpsApiDetail[],
    enabled: enEdition && typeSource === "BULLETIN",
  });

  useEffect(() => {
    if (!enEdition || corpsPrefillFait || !corpsExistants) return;
    setCorpsListe(
      corpsExistants.map((c) => ({
        id: c.id,
        corps_code: c.corps_code,
        libelle: c.libelle,
        ordre_affichage: c.ordre_affichage,
        visible: c.visible,
        couleur_fond: c.couleur_fond || "",
        couleur_texte: c.couleur_texte || "",
        police: c.police || "",
        taille_police: c.taille_police ?? "",
        gras: c.gras,
        colonnes: c.colonnes.map((col) => ({ ...col })),
        rubriques: c.rubriques.map((r) => ({
          rubrique_paie_code: r.rubrique_paie_code,
          libelle: r.libelle || r.rubrique_paie_code,
          libelle_personnalise: r.libelle_personnalise || "",
          mappings: r.mappings.map((m) => ({ ...m })),
        })),
        lignesSpeciales: c.lignes_speciales.map((l) => ({
          code_constante: l.code_constante,
          libelle: l.libelle,
          code_colonne: l.code_colonne || "",
        })),
        blocs: [],
      }))
    );
    setCorpsPrefillFait(true);
  }, [enEdition, corpsPrefillFait, corpsExistants]);

  const rubriqueDejaUtiliseeCorps = (code: string, corpsIndexActuel: number): string | null => {
    for (let i = 0; i < corpsListe.length; i++) {
      if (i === corpsIndexActuel) continue;
      if (corpsListe[i].rubriques.some((r) => r.rubrique_paie_code === code)) return corpsListe[i].libelle;
    }
    return null;
  };

  const ajouterCorps = () => {
    setCorpsListe((prev) => [
      ...prev,
      {
        corps_code: coderCode(`corps_${prev.length + 1}`, "corps"),
        libelle: `Nouveau corps ${prev.length + 1}`,
        ordre_affichage: prev.length,
        visible: true,
        couleur_fond: "",
        couleur_texte: "",
        police: "",
        taille_police: "",
        gras: false,
        colonnes: [],
        rubriques: [],
        lignesSpeciales: [],
        blocs: [],
      },
    ]);
  };

  const supprimerCorps = (index: number) => {
    setCorpsListe((prev) => {
      const cible = prev[index];
      if (cible.id) setCorpsSupprimes((s) => [...s, cible.id!]);
      return prev.filter((_, i) => i !== index);
    });
  };

  const majCorps = <K extends keyof CorpsLocal>(index: number, champ: K, valeur: CorpsLocal[K]) => {
    setCorpsListe((prev) => prev.map((c, i) => (i === index ? { ...c, [champ]: valeur } : c)));
  };

  // -- Colonnes --

  const ajouterColonne = (corpsIndex: number, libelle: string, format: string) => {
    if (!libelle.trim()) return;
    setCorpsListe((prev) =>
      prev.map((c, i) =>
        i === corpsIndex
          ? { ...c, colonnes: [...c.colonnes, { code_colonne: coderCode(libelle, "col"), libelle, format }] }
          : c
      )
    );
  };

  const supprimerColonne = (corpsIndex: number, code_colonne: string) => {
    setCorpsListe((prev) =>
      prev.map((c, i) => {
        if (i !== corpsIndex) return c;
        return {
          ...c,
          colonnes: c.colonnes.filter((col) => col.code_colonne !== code_colonne),
          // Reflète côté client le ON DELETE CASCADE / SET NULL du backend :
          // un mapping vers une colonne supprimée disparaît, une ligne
          // spéciale qui la référençait redevient non mappée.
          rubriques: c.rubriques.map((r) => ({
            ...r,
            mappings: r.mappings.filter((m) => m.code_colonne !== code_colonne),
          })),
          lignesSpeciales: c.lignesSpeciales.map((l) =>
            l.code_colonne === code_colonne ? { ...l, code_colonne: "" } : l
          ),
        };
      })
    );
  };

  // -- Rubriques + mappings --

  const ajouterPlusieursRubriquesACorps = (corpsIndex: number, codes: string[]) => {
    setCorpsListe((prev) =>
      prev.map((c, i) => {
        if (i !== corpsIndex) return c;
        const nouvelles: CorpsRubriqueLocal[] = codes
          .map((code) => (rubriquesDisponibles || []).find((r) => r.code === code))
          .filter((r): r is RubriquePaieOption => !!r)
          .map((r) => ({ rubrique_paie_code: r.code, libelle: r.libelle, libelle_personnalise: "", mappings: [] }));
        return { ...c, rubriques: [...c.rubriques, ...nouvelles] };
      })
    );
  };

  const retirerRubriqueDeCorps = (corpsIndex: number, code: string) => {
    setCorpsListe((prev) =>
      prev.map((c, i) =>
        i === corpsIndex ? { ...c, rubriques: c.rubriques.filter((r) => r.rubrique_paie_code !== code) } : c
      )
    );
  };

  const majLibellePersonnaliseRubrique = (corpsIndex: number, rubrique_paie_code: string, valeur: string) => {
    setCorpsListe((prev) =>
      prev.map((c, i) =>
        i === corpsIndex
          ? {
              ...c,
              rubriques: c.rubriques.map((r) =>
                r.rubrique_paie_code === rubrique_paie_code ? { ...r, libelle_personnalise: valeur } : r
              ),
            }
          : c
      )
    );
  };

  const deplacerRubriqueDansCorps = (corpsIndex: number, rubriqueIndex: number, direction: -1 | 1) => {
    setCorpsListe((prev) =>
      prev.map((c, i) => {
        if (i !== corpsIndex) return c;
        const cible = rubriqueIndex + direction;
        if (cible < 0 || cible >= c.rubriques.length) return c;
        const next = [...c.rubriques];
        [next[rubriqueIndex], next[cible]] = [next[cible], next[rubriqueIndex]];
        return { ...c, rubriques: next };
      })
    );
  };

  const majMappingRubrique = (
    corpsIndex: number,
    rubrique_paie_code: string,
    attribut: AttributRubrique,
    code_colonne: string
  ) => {
    setCorpsListe((prev) =>
      prev.map((c, i) => {
        if (i !== corpsIndex) return c;
        return {
          ...c,
          rubriques: c.rubriques.map((r) => {
            if (r.rubrique_paie_code !== rubrique_paie_code) return r;
            const autres = r.mappings.filter((m) => m.attribut !== attribut);
            return { ...r, mappings: code_colonne ? [...autres, { attribut, code_colonne }] : autres };
          }),
        };
      })
    );
  };

  // -- Lignes spéciales --

  const ajouterLigneSpeciale = (corpsIndex: number) => {
    setCorpsListe((prev) =>
      prev.map((c, i) =>
        i === corpsIndex
          ? { ...c, lignesSpeciales: [...c.lignesSpeciales, { code_constante: "", libelle: "", code_colonne: "" }] }
          : c
      )
    );
  };

  const majLigneSpeciale = (corpsIndex: number, ligneIndex: number, champ: keyof CorpsLigneSpecialeLocal, valeur: string) => {
    setCorpsListe((prev) =>
      prev.map((c, i) =>
        i === corpsIndex
          ? { ...c, lignesSpeciales: c.lignesSpeciales.map((l, j) => (j === ligneIndex ? { ...l, [champ]: valeur } : l)) }
          : c
      )
    );
  };

  const supprimerLigneSpeciale = (corpsIndex: number, ligneIndex: number) => {
    setCorpsListe((prev) =>
      prev.map((c, i) => (i === corpsIndex ? { ...c, lignesSpeciales: c.lignesSpeciales.filter((_, j) => j !== ligneIndex) } : c))
    );
  };

  const deplacerLigneSpecialeDansCorps = (corpsIndex: number, ligneIndex: number, direction: -1 | 1) => {
    setCorpsListe((prev) =>
      prev.map((c, i) => {
        if (i !== corpsIndex) return c;
        const cible = ligneIndex + direction;
        if (cible < 0 || cible >= c.lignesSpeciales.length) return c;
        const next = [...c.lignesSpeciales];
        [next[ligneIndex], next[cible]] = [next[cible], next[ligneIndex]];
        return { ...c, lignesSpeciales: next };
      })
    );
  };

  // -- Blocs (imbriqués dans un corps) --

  const [blocsPrefillFait, setBlocsPrefillFait] = useState(false);
  const [blocsSupprimes, setBlocsSupprimes] = useState<string[]>([]);

  interface BlocApiDetail {
    id: string;
    bloc_code: string;
    libelle: string;
    ordre_affichage: number;
    visible: boolean;
    couleur_fond: string | null;
    couleur_texte: string | null;
    police: string | null;
    taille_police: number | null;
    gras: boolean;
    position_libelle: PositionLibelleBloc;
    position_total: PositionTotalBloc;
    rubriques: { rubrique_paie_code: string }[];
    colonnes_total: { code_colonne: string }[];
  }

  // Chargement des blocs de chaque corps existant -- une seule fois, une
  // fois le pré-remplissage des corps terminé (dépend de leurs id réels).
  useEffect(() => {
    if (!enEdition || !corpsPrefillFait || blocsPrefillFait || corpsListe.length === 0) return;
    (async () => {
      const corpsAvecBlocs = await Promise.all(
        corpsListe.map(async (c) => {
          if (!c.id) return c;
          try {
            const blocsApi = (await api.get(`/etats/${id}/corps/${c.id}/blocs`)) as BlocApiDetail[];
            return {
              ...c,
              blocs: blocsApi.map((b) => ({
                id: b.id,
                bloc_code: b.bloc_code,
                libelle: b.libelle,
                ordre_affichage: b.ordre_affichage,
                visible: b.visible,
                couleur_fond: b.couleur_fond || "",
                couleur_texte: b.couleur_texte || "",
                police: b.police || "",
                taille_police: b.taille_police ?? "",
                gras: b.gras,
                position_libelle: b.position_libelle,
                position_total: b.position_total,
                rubriques: b.rubriques.map((r) => r.rubrique_paie_code),
                colonnesTotal: b.colonnes_total.map((c2) => c2.code_colonne),
              })),
            };
          } catch {
            return c;
          }
        })
      );
      setCorpsListe(corpsAvecBlocs);
      setBlocsPrefillFait(true);
    })();
  }, [enEdition, corpsPrefillFait, blocsPrefillFait, corpsListe.length]);

  const rubriqueDejaUtiliseeBloc = (corpsIndex: number, rubrique_paie_code: string, blocIndexActuel: number): string | null => {
    const blocs = corpsListe[corpsIndex]?.blocs || [];
    for (let i = 0; i < blocs.length; i++) {
      if (i === blocIndexActuel) continue;
      if (blocs[i].rubriques.includes(rubrique_paie_code)) return blocs[i].libelle;
    }
    return null;
  };

  const ajouterBlocDansCorps = (corpsIndex: number) => {
    setCorpsListe((prev) =>
      prev.map((c, i) =>
        i === corpsIndex
          ? {
              ...c,
              blocs: [
                ...c.blocs,
                {
                  bloc_code: coderCode(`bloc_${c.blocs.length + 1}`, "bloc"),
                  libelle: `Nouveau bloc ${c.blocs.length + 1}`,
                  ordre_affichage: c.blocs.length,
                  visible: true,
                  couleur_fond: "",
                  couleur_texte: "",
                  police: "",
                  taille_police: "",
                  gras: false,
                  position_libelle: "DEBUT" as PositionLibelleBloc,
                  position_total: "AUCUN" as PositionTotalBloc,
                  rubriques: [],
                  colonnesTotal: [],
                },
              ],
            }
          : c
      )
    );
  };

  const supprimerBlocDeCorps = (corpsIndex: number, blocIndex: number) => {
    setCorpsListe((prev) =>
      prev.map((c, i) => {
        if (i !== corpsIndex) return c;
        const cible = c.blocs[blocIndex];
        if (cible.id) setBlocsSupprimes((s) => [...s, cible.id!]);
        return { ...c, blocs: c.blocs.filter((_, j) => j !== blocIndex) };
      })
    );
  };

  const majBlocDansCorps = <K extends keyof BlocLocal>(corpsIndex: number, blocIndex: number, champ: K, valeur: BlocLocal[K]) => {
    setCorpsListe((prev) =>
      prev.map((c, i) =>
        i === corpsIndex
          ? { ...c, blocs: c.blocs.map((b, j) => (j === blocIndex ? { ...b, [champ]: valeur } : b)) }
          : c
      )
    );
  };

  const toggleRubriqueDansBloc = (corpsIndex: number, blocIndex: number, rubrique_paie_code: string) => {
    setCorpsListe((prev) =>
      prev.map((c, i) =>
        i === corpsIndex
          ? {
              ...c,
              blocs: c.blocs.map((b, j) =>
                j === blocIndex
                  ? {
                      ...b,
                      rubriques: b.rubriques.includes(rubrique_paie_code)
                        ? b.rubriques.filter((r) => r !== rubrique_paie_code)
                        : [...b.rubriques, rubrique_paie_code],
                    }
                  : b
              ),
            }
          : c
      )
    );
  };

  const toggleColonneTotalDansBloc = (corpsIndex: number, blocIndex: number, code_colonne: string) => {
    setCorpsListe((prev) =>
      prev.map((c, i) =>
        i === corpsIndex
          ? {
              ...c,
              blocs: c.blocs.map((b, j) =>
                j === blocIndex
                  ? {
                      ...b,
                      colonnesTotal: b.colonnesTotal.includes(code_colonne)
                        ? b.colonnesTotal.filter((cc) => cc !== code_colonne)
                        : [...b.colonnesTotal, code_colonne],
                    }
                  : b
              ),
            }
          : c
      )
    );
  };

  // ── Actions étape 4 (pied de page) ───────────────────────────────────────

  const inserer_variable = (variable: string) => {
    const el = pieddepageRef.current;
    if (!el) {
      setPiedDePage((prev) => prev + variable);
      return;
    }
    const debut = el.selectionStart ?? piedDePage.length;
    const fin = el.selectionEnd ?? piedDePage.length;
    const nouveau = piedDePage.slice(0, debut) + variable + piedDePage.slice(fin);
    setPiedDePage(nouveau);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = debut + variable.length;
    });
  };

  // ── Actions étape 4 (écrans) ──────────────────────────────────────────────

  const ecransCompatibles = useMemo(() => {
    if (!sourceChoisie) return ecrans || [];
    return (ecrans || []).filter((e) =>
      sourceChoisie.contexte_requis.every((c) => e.contexte_disponible.includes(c))
    );
  }, [ecrans, sourceChoisie]);

  const toggleEcran = (code_ecran: string) => {
    setEcransSelectionnes((prev) => {
      const next = new Set(prev);
      next.has(code_ecran) ? next.delete(code_ecran) : next.add(code_ecran);
      return next;
    });
  };

  // ── Validation par étape ──────────────────────────────────────────────────

  const etapeValide = (n: number): boolean => {
    if (n === 1) return code.trim().length > 0 && nom.trim().length > 0 && !!typeSource;
    return true;
  };

  // ── Soumission finale ──────────────────────────────────────────────────────

  // Extrait de creer() pour être réutilisable par l'aperçu (qui doit
  // sauvegarder sans naviguer ni afficher de toast de confirmation).
  const sauvegarderEtat = async (): Promise<string> => {
    const etatId = enEdition
      ? id!
      : ((await api.post("/etats", {
          code,
          nom,
          description: description || null,
          type_source: typeSource,
          modele_code: modeleCode || null,
          afficher_logo: afficherLogo,
          pied_de_page_html: piedDePage || null,
          format_sortie: formatSortie,
          visibilite,
        })) as { id: string }).id;

      if (enEdition) {
        await api.patch(`/etats/${etatId}`, {
          nom,
          description: description || null,
          modele_code: modeleCode || null,
          afficher_logo: afficherLogo,
          pied_de_page_html: piedDePage || null,
          format_sortie: formatSortie,
          visibilite,
        });
      }

      if (champs.length > 0) {
        await api.put(
          `/etats/${etatId}/champs`,
          champs.map((c, i) => ({
            champ_code: c.champ_code,
            visible: c.visible,
            ordre_affichage: i,
            mode_donnee: c.mode_donnee,
          }))
        );
      }

      // Corps (BULLETIN uniquement) — création/mise à jour/suppression, puis
      // colonnes, rubriques+mappings et lignes spéciales pour chaque corps
      // désormais persisté. Ordre important : les colonnes doivent exister
      // avant qu'on puisse y référencer un mapping de rubrique/ligne spéciale.
      if (typeSource === "BULLETIN") {
        for (const supprId of corpsSupprimes) {
          await api.delete(`/etats/${etatId}/corps/${supprId}`);
        }
        for (let i = 0; i < corpsListe.length; i++) {
          const corps = corpsListe[i];
          const payloadCorps = {
            libelle: corps.libelle,
            ordre_affichage: i,
            visible: corps.visible,
            couleur_fond: corps.couleur_fond || null,
            couleur_texte: corps.couleur_texte || null,
            police: corps.police || null,
            taille_police: corps.taille_police === "" ? null : corps.taille_police,
            gras: corps.gras,
          };
          let corpsId = corps.id;
          if (!corpsId) {
            const cree = (await api.post(`/etats/${etatId}/corps`, {
              corps_code: corps.corps_code,
              ...payloadCorps,
            })) as { id: string };
            corpsId = cree.id;
          } else {
            await api.patch(`/etats/${etatId}/corps/${corpsId}`, payloadCorps);
          }

          await api.put(
            `/etats/${etatId}/corps/${corpsId}/colonnes`,
            corps.colonnes.map((col, j) => ({
              code_colonne: col.code_colonne,
              libelle: col.libelle,
              format: col.format,
              ordre_affichage: j,
            }))
          );

          await api.put(
            `/etats/${etatId}/corps/${corpsId}/rubriques`,
            corps.rubriques.map((r, j) => ({
              rubrique_paie_code: r.rubrique_paie_code,
              ordre_affichage: j,
              libelle_personnalise: r.libelle_personnalise || null,
              mappings: r.mappings.map((m) => ({ attribut: m.attribut, code_colonne: m.code_colonne })),
            }))
          );

          await api.put(
            `/etats/${etatId}/corps/${corpsId}/lignes-speciales`,
            corps.lignesSpeciales
              .filter((l) => l.code_constante.trim() && l.libelle.trim())
              .map((l, j) => ({
                code_constante: l.code_constante,
                libelle: l.libelle,
                code_colonne: l.code_colonne || null,
                ordre_affichage: j,
              }))
          );

          // Blocs de ce corps -- après colonnes/rubriques du corps, puisque
          // chaque bloc référence des rubriques/colonnes qui doivent déjà
          // exister sur ce corps.
          for (const supprBlocId of blocsSupprimes) {
            await api.delete(`/etats/${etatId}/corps/${corpsId}/blocs/${supprBlocId}`);
          }
          for (let k = 0; k < corps.blocs.length; k++) {
            const bloc = corps.blocs[k];
            const payloadBloc = {
              libelle: bloc.libelle,
              ordre_affichage: k,
              visible: bloc.visible,
              couleur_fond: bloc.couleur_fond || null,
              couleur_texte: bloc.couleur_texte || null,
              police: bloc.police || null,
              taille_police: bloc.taille_police === "" ? null : bloc.taille_police,
              gras: bloc.gras,
              position_libelle: bloc.position_libelle,
              position_total: bloc.position_total,
            };
            let blocId = bloc.id;
            if (!blocId) {
              const creeBloc = (await api.post(`/etats/${etatId}/corps/${corpsId}/blocs`, {
                bloc_code: bloc.bloc_code,
                ...payloadBloc,
              })) as { id: string };
              blocId = creeBloc.id;
            } else {
              await api.patch(`/etats/${etatId}/corps/${corpsId}/blocs/${blocId}`, payloadBloc);
            }

            await api.put(
              `/etats/${etatId}/corps/${corpsId}/blocs/${blocId}/rubriques`,
              bloc.rubriques.map((code, j) => ({ rubrique_paie_code: code, ordre_affichage: j }))
            );
            await api.put(
              `/etats/${etatId}/corps/${corpsId}/blocs/${blocId}/colonnes-total`,
              bloc.colonnesTotal.map((code) => ({ code_colonne: code }))
            );
          }
        }
      }

      if (enEdition) {
        // Réconciliation écrans : seuls les endpoints ajout/retrait unitaires
        // existent côté API (pas de "remplacer toute la liste" comme pour
        // les champs) -- on calcule donc le différentiel ici.
        const ajouts = Array.from(ecransSelectionnes).filter((c) => !ecransOriginaux.has(c));
        const retraits = Array.from(ecransOriginaux).filter((c) => !ecransSelectionnes.has(c));
        if (ajouts.length > 0) {
          await api.post(`/etats/${etatId}/ecrans`, { codes_ecran: ajouts });
        }
        for (const code_ecran of retraits) {
          await api.delete(`/etats/${etatId}/ecrans/${code_ecran}`);
        }
      } else if (ecransSelectionnes.size > 0) {
        await api.post(`/etats/${etatId}/ecrans`, {
          codes_ecran: Array.from(ecransSelectionnes),
        });
      }

      return etatId;
  };

  const creer = async () => {
    setSoumission(true);
    try {
      const etatId = await sauvegarderEtat();
      toast({
        title: enEdition ? "État modifié" : "État créé",
        description: enEdition
          ? `« ${nom} » a été mis à jour.`
          : `« ${nom} » a été créé en brouillon.`,
      });
      qc.invalidateQueries({ queryKey: ["etats-liste"] });
      qc.invalidateQueries({ queryKey: ["etat-detail", etatId] });
      navigate("/etats");
    } catch (e: any) {
      toast({
        title: enEdition ? "Échec de la modification" : "Échec de la création",
        description: e?.message || "Une erreur est survenue.",
        variant: "destructive",
      });
    } finally {
      setSoumission(false);
    }
  };

  // Aperçu : sauvegarde silencieusement (pas de toast/navigation), puis
  // demande le PDF réel au moteur de rendu pour un collaborateur/période
  // donnés. Nécessite d'être en édition (état déjà créé) -- en création,
  // ré-appeler sauvegarderEtat() créerait un doublon (le code est unique).
  //
  // ⚠️ collaborateur_id/periode_id saisis en UUID brut faute d'un endpoint
  // de recherche collaborateur/période confirmé à ce stade -- à remplacer
  // par de vrais sélecteurs une fois ces endpoints identifiés.
  // -- Recherche collaborateur (matricule ou nom) --

  interface CollaborateurOption { id: string; matricule: string; nom: string; prenom: string }

  const { data: collabResultats, isFetching: rechercheEnCours } = useQuery({
    queryKey: ["recherche-collaborateur-apercu", rechercheCollab],
    queryFn: async () => {
      const terme = rechercheCollab.trim();
      const [parMatricule, parNom] = await Promise.all([
        db.list<CollaborateurOption>("collaborateurs", {
          select: "id,matricule,nom,prenom",
          matricule: `ilike.%${terme}%`,
          archive: false,
          limit: 8,
        }),
        db.list<CollaborateurOption>("collaborateurs", {
          select: "id,matricule,nom,prenom",
          nom: `ilike.%${terme}%`,
          archive: false,
          limit: 8,
        }),
      ]);
      const fusion = new Map<string, CollaborateurOption>();
      [...parMatricule, ...parNom].forEach((c) => fusion.set(c.id, c));
      return Array.from(fusion.values());
    },
    enabled: rechercheCollab.trim().length >= 2,
  });

  // -- Bulletins du collaborateur sélectionné (plan de paie + période) --

  interface BulletinOption { id: string; periode_id: string; code_plan: string | null; statut: string; created_at: string }
  interface PeriodeOption { id: string; date_reference: string }

  const { data: bulletinsDisponibles } = useQuery({
    queryKey: ["bulletins-collaborateur-apercu", collabSelectionne?.id],
    queryFn: async () => {
      const bulletins = await db.list<BulletinOption>("bulletin", {
        select: "id,periode_id,code_plan,statut,created_at",
        collaborateur_id: collabSelectionne!.id,
        order: "-created_at",
        limit: 20,
      });
      const periodeIds = Array.from(new Set(bulletins.map((b) => b.periode_id)));
      const periodes = periodeIds.length
        ? await db.list<PeriodeOption>("calendrier_paie", {
            select: "id,date_reference",
            id: `in.(${periodeIds.join(",")})`,
          })
        : [];
      const dateParPeriode = new Map(periodes.map((p) => [p.id, p.date_reference]));
      return bulletins.map((b) => ({ ...b, date_reference: dateParPeriode.get(b.periode_id) || null }));
    },
    enabled: !!collabSelectionne,
  });

  const choisirCollaborateur = (c: CollaborateurOption) => {
    setCollabSelectionne(c);
    setCollabApercu(c.id);
    setRechercheCollab("");
    setBulletinSelectionneId("");
    setPeriodeApercu("");
  };

  const choisirBulletin = (b: BulletinOption) => {
    setBulletinSelectionneId(b.id);
    setPeriodeApercu(b.periode_id);
  };

  const genererApercu = async () => {
    if (!collabApercu.trim() || !periodeApercu.trim()) {
      toast({ title: "Champs requis", description: "Renseigne un collaborateur et une période pour l'aperçu.", variant: "destructive" });
      return;
    }
    setGenerationApercu(true);
    try {
      const etatId = await sauvegarderEtat();
      const url = `${API_BASE}/etats/${etatId}/rendu?collaborateur_id=${encodeURIComponent(collabApercu.trim())}&periode_id=${encodeURIComponent(periodeApercu.trim())}`;
      const token = tokenStore.get();
      const reponse = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!reponse.ok) {
        const erreur = await reponse.json().catch(() => ({ detail: "Erreur inconnue" }));
        throw new Error(erreur.detail || "Échec de la génération de l'aperçu.");
      }
      const blob = await reponse.blob();
      window.open(URL.createObjectURL(blob), "_blank");
      qc.invalidateQueries({ queryKey: ["etats-liste"] });
    } catch (e: any) {
      toast({ title: "Échec de l'aperçu", description: e?.message || "Une erreur est survenue.", variant: "destructive" });
    } finally {
      setGenerationApercu(false);
    }
  };

  // ── Rendu ────────────────────────────────────────────────────────────────

  return (
    <div className="p-5 space-y-5">
      {/* En-tête */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate("/etats")}>
          <ArrowLeft size={14} /> Retour
        </Button>
      </div>
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}>
          <FileText size={20} /> {enEdition ? "Modifier l'état" : "Nouvel état"}
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
          {enEdition
            ? "Le code et la source de données ne sont plus modifiables une fois l'état créé."
            : "L'état sera créé en brouillon — vous le publierez depuis la liste une fois prêt."}
        </p>
      </div>

      {enEdition && chargementEtat ? (
        <div className="flex items-center justify-center py-16" style={{ color: "hsl(var(--muted-foreground))" }}>
          <Loader2 size={20} className="animate-spin mr-2" /> Chargement de l'état…
        </div>
      ) : (
      <>

      {/* Fil d'étapes */}
      <div className="flex gap-1">
        {ETAPES.map((e) => (
          <div key={e.n} className="flex-1 text-center pb-2" style={{
            borderBottom: `2px solid ${etape === e.n ? "hsl(var(--primary))" : "hsl(var(--border))"}`,
          }}>
            <span className="text-xs font-medium" style={{
              color: etape === e.n ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
            }}>
              {e.n}. {e.label}
            </span>
          </div>
        ))}
      </div>

      {/* ── Étape 1 : Source ── */}
      {etape === 1 && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="w-72">
              <label className="text-xs font-medium mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>
                Code
              </label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="ex. attestation_travail"
                disabled={enEdition}
              />
            </div>
            <div className="w-72">
              <label className="text-xs font-medium mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>
                Nom
              </label>
              <Input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="ex. Attestation de travail" />
            </div>
          </div>
          <div className="w-full max-w-xl">
            <label className="text-xs font-medium mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>
              Description (optionnel)
            </label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="À quoi sert cet état ?" />
          </div>

          <div>
            <label className="text-xs font-medium mb-2 block" style={{ color: "hsl(var(--muted-foreground))" }}>
              Source de données
            </label>
            {chargementSources ? (
              <div className="flex items-center gap-2 text-sm py-4" style={{ color: "hsl(var(--muted-foreground))" }}>
                <Loader2 size={16} className="animate-spin" /> Chargement…
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(typesSource || []).filter((s) => s.actif).map((s) => (
                  <button
                    key={s.code}
                    type="button"
                    disabled={enEdition}
                    onClick={() => setTypeSource(s.code)}
                    className="rounded-lg px-4 py-3 text-center transition-colors w-40"
                    style={{
                      border: `2px solid ${typeSource === s.code ? "hsl(var(--primary))" : "hsl(var(--border))"}`,
                      background: typeSource === s.code ? "hsl(var(--primary) / 0.06)" : "transparent",
                      opacity: enEdition && typeSource !== s.code ? 0.4 : 1,
                      cursor: enEdition ? "not-allowed" : "pointer",
                    }}
                  >
                    <div className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>
                      {s.libelle}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Étape 2 : Champs ── */}
      {etape === 2 && (
        <div className="rounded-2xl border p-4 max-w-3xl" style={{ borderColor: "hsl(var(--border))" }}>
          <p className="text-sm font-medium mb-1" style={{ color: "hsl(var(--foreground))" }}>
            Champs à afficher
          </p>
          <p className="text-xs mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
            Décocher un champ ne l'empêche pas d'être calculé — il n'apparaîtra simplement pas sur le document.
          </p>
          {chargementChamps ? (
            <div className="flex items-center gap-2 text-sm py-6 justify-center" style={{ color: "hsl(var(--muted-foreground))" }}>
              <Loader2 size={16} className="animate-spin" /> Chargement des champs…
            </div>
          ) : champs.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: "hsl(var(--muted-foreground))" }}>
              Aucun champ disponible pour cette source pour l'instant.
            </p>
          ) : (
            <div className="space-y-0.5">
              {champs.map((c, i) => (
                <div
                  key={c.champ_code}
                  className="flex items-center gap-2 py-1.5"
                  style={{ borderBottom: i < champs.length - 1 ? "1px solid hsl(var(--border))" : undefined }}
                >
                  <div className="flex flex-col">
                    <button type="button" disabled={i === 0} onClick={() => deplacerChamp(i, -1)}
                      style={{ color: "hsl(var(--muted-foreground))", opacity: i === 0 ? 0.3 : 1 }}>
                      <ChevronUp size={13} />
                    </button>
                    <button type="button" disabled={i === champs.length - 1} onClick={() => deplacerChamp(i, 1)}
                      style={{ color: "hsl(var(--muted-foreground))", opacity: i === champs.length - 1 ? 0.3 : 1 }}>
                      <ChevronDown size={13} />
                    </button>
                  </div>
                  <input
                    type="checkbox"
                    checked={c.visible}
                    onChange={() => toggleChampVisible(c.champ_code)}
                    className="ml-1"
                  />
                  <span className="text-sm flex-1" style={{ color: c.visible ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))" }}>
                    {c.libelle}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleChampMode(c.champ_code)}
                    className="text-[10px] px-2 py-0.5 rounded-full"
                    style={{
                      background: "hsl(var(--muted))",
                      color: "hsl(var(--muted-foreground))",
                    }}
                    title="Basculer entre figé à la période et toujours actuel"
                  >
                    {c.mode_donnee === "PERIODE" ? "Figé période" : "Toujours actuel"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Étape 3 : Corps (BULLETIN uniquement) ── */}
      {etape === 3 && (
        <div className="space-y-3 w-full">
          {typeSource !== "BULLETIN" ? (
            <div
              className="rounded-2xl border p-6 text-sm text-center"
              style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}
            >
              Cette étape ne s'applique qu'aux états de type « Bulletin de paie ». Rien à configurer ici pour « {sourceChoisie?.libelle} ».
            </div>
          ) : (
            <>
              <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                Un corps est une section du bulletin (ex. tableau des rubriques, tableau des cumuls),
                avec ses propres colonnes nommées. Pour chaque rubrique, indiquez quel attribut
                (Nombre/Montant/Taux) atterrit dans quelle colonne.
              </p>

              {corpsListe.map((corps, corpsIndex) => (
                <div key={corps.id || `nouveau-${corpsIndex}`} className="rounded-2xl border p-4" style={{ borderColor: "hsl(var(--border))" }}>
                  {/* En-tête du corps */}
                  <div className="flex items-center gap-2 mb-3">
                    <Input
                      value={corps.libelle}
                      onChange={(e) => majCorps(corpsIndex, "libelle", e.target.value)}
                      className="flex-1 font-medium"
                    />
                    <button
                      type="button"
                      onClick={() => majCorps(corpsIndex, "visible", !corps.visible)}
                      className="text-[11px] px-2 py-1 rounded-full shrink-0"
                      style={{
                        background: corps.visible ? "hsl(142 71% 45% / 0.15)" : "hsl(var(--muted))",
                        color: corps.visible ? "hsl(142 71% 35%)" : "hsl(var(--muted-foreground))",
                      }}
                    >
                      {corps.visible ? "Visible" : "Masqué"}
                    </button>
                    <button
                      type="button"
                      onClick={() => supprimerCorps(corpsIndex)}
                      className="text-[11px] px-2 py-1 rounded-full shrink-0"
                      style={{ background: "hsl(0 84% 60% / 0.1)", color: "hsl(0 70% 45%)" }}
                    >
                      Supprimer
                    </button>
                  </div>

                  {/* Style */}
                  <div className="flex flex-wrap items-center gap-3 mb-3 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                    <label className="flex items-center gap-1.5">
                      Fond
                      <input type="color" value={corps.couleur_fond || "#ffffff"} onChange={(e) => majCorps(corpsIndex, "couleur_fond", e.target.value)} className="w-6 h-6 rounded border-0 cursor-pointer" />
                    </label>
                    <label className="flex items-center gap-1.5">
                      Texte
                      <input type="color" value={corps.couleur_texte || "#000000"} onChange={(e) => majCorps(corpsIndex, "couleur_texte", e.target.value)} className="w-6 h-6 rounded border-0 cursor-pointer" />
                    </label>
                    <label className="flex items-center gap-1.5">
                      Police
                      <select value={corps.police} onChange={(e) => majCorps(corpsIndex, "police", e.target.value)} className="text-xs rounded border px-1.5 py-1" style={{ borderColor: "hsl(var(--border))", background: "transparent" }}>
                        <option value="">Par défaut</option>
                        <option value="Arial">Arial</option>
                        <option value="Helvetica">Helvetica</option>
                        <option value="Times New Roman">Times New Roman</option>
                        <option value="Courier New">Courier New</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5">
                      Taille
                      <input type="number" min={6} max={24} value={corps.taille_police} onChange={(e) => majCorps(corpsIndex, "taille_police", e.target.value ? Number(e.target.value) : "")} className="w-14 text-xs rounded border px-1.5 py-1" style={{ borderColor: "hsl(var(--border))", background: "transparent" }} />
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={corps.gras} onChange={(e) => majCorps(corpsIndex, "gras", e.target.checked)} />
                      Gras
                    </label>
                  </div>

                  {/* Colonnes nommées */}
                  <div className="rounded-lg p-3 mb-3" style={{ background: "hsl(var(--muted) / 0.4)" }}>
                    <p className="text-xs font-medium mb-2" style={{ color: "hsl(var(--foreground))" }}>Colonnes</p>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {corps.colonnes.map((col) => (
                        <span key={col.code_colonne} className="text-xs px-2 py-1 rounded-full flex items-center gap-1" style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))" }}>
                          {col.libelle}
                          <span className="opacity-50">({FORMATS_COLONNE.find((f) => f.code === col.format)?.libelle || col.format})</span>
                          <button type="button" onClick={() => supprimerColonne(corpsIndex, col.code_colonne)} className="opacity-60 hover:opacity-100">×</button>
                        </span>
                      ))}
                    </div>
                    <FormulaireNouvelleColonne onAjouter={(libelle, format) => ajouterColonne(corpsIndex, libelle, format)} />
                  </div>

                  {/* Aperçu du style */}
                  <div
                    className="text-sm px-3 py-2 rounded mb-3"
                    style={{
                      background: corps.couleur_fond || "hsl(var(--muted))",
                      color: corps.couleur_texte || "hsl(var(--foreground))",
                      fontFamily: corps.police || undefined,
                      fontSize: corps.taille_police ? `${corps.taille_police}px` : undefined,
                      fontWeight: corps.gras ? 700 : 400,
                    }}
                  >
                    Aperçu — {corps.libelle}
                  </div>

                  {/* Rubriques + mapping attribut -> colonne */}
                  <div className="mb-2">
                    <p className="text-xs font-medium mb-2" style={{ color: "hsl(var(--foreground))" }}>Rubriques</p>
                    {corps.rubriques.length > 0 && (
                      <div className="rounded-lg border overflow-hidden mb-2" style={{ borderColor: "hsl(var(--border))" }}>
                        <table className="w-full text-xs">
                          <thead style={{ background: "hsl(var(--muted))" }}>
                            <tr>
                              <th className="w-10" />
                              <th className="text-left px-2 py-1.5">Rubrique</th>
                              <th className="text-left px-2 py-1.5">Intitulé affiché</th>
                              {ATTRIBUTS_RUBRIQUE.map((attr) => (
                                <th key={attr} className="text-left px-2 py-1.5">{LIBELLE_ATTRIBUT[attr]}</th>
                              ))}
                              <th className="w-8" />
                            </tr>
                          </thead>
                          <tbody>
                            {corps.rubriques.map((r, rubriqueIndex) => (
                              <tr key={r.rubrique_paie_code} style={{ borderTop: "1px solid hsl(var(--border))" }}>
                                <td className="px-1 py-1.5">
                                  <div className="flex flex-col">
                                    <button type="button" disabled={rubriqueIndex === 0} onClick={() => deplacerRubriqueDansCorps(corpsIndex, rubriqueIndex, -1)}
                                      style={{ color: "hsl(var(--muted-foreground))", opacity: rubriqueIndex === 0 ? 0.3 : 1 }}>
                                      <ChevronUp size={12} />
                                    </button>
                                    <button type="button" disabled={rubriqueIndex === corps.rubriques.length - 1} onClick={() => deplacerRubriqueDansCorps(corpsIndex, rubriqueIndex, 1)}
                                      style={{ color: "hsl(var(--muted-foreground))", opacity: rubriqueIndex === corps.rubriques.length - 1 ? 0.3 : 1 }}>
                                      <ChevronDown size={12} />
                                    </button>
                                  </div>
                                </td>
                                <td className="px-2 py-1.5" style={{ color: "hsl(var(--foreground))" }}>{r.libelle}</td>
                                <td className="px-2 py-1.5">
                                  <Input
                                    value={r.libelle_personnalise}
                                    onChange={(e) => majLibellePersonnaliseRubrique(corpsIndex, r.rubrique_paie_code, e.target.value)}
                                    placeholder={r.libelle}
                                    className="text-xs h-7 w-64"
                                  />
                                </td>
                                {ATTRIBUTS_RUBRIQUE.map((attr) => {
                                  const valeurActuelle = r.mappings.find((m) => m.attribut === attr)?.code_colonne || "";
                                  return (
                                    <td key={attr} className="px-2 py-1.5">
                                      <select
                                        value={valeurActuelle}
                                        onChange={(e) => majMappingRubrique(corpsIndex, r.rubrique_paie_code, attr, e.target.value)}
                                        className="text-xs rounded border px-1 py-0.5 w-full"
                                        style={{ borderColor: "hsl(var(--border))", background: "transparent" }}
                                      >
                                        <option value="">—</option>
                                        {corps.colonnes.map((col) => (
                                          <option key={col.code_colonne} value={col.code_colonne}>{col.libelle}</option>
                                        ))}
                                      </select>
                                    </td>
                                  );
                                })}
                                <td className="px-2 py-1.5 text-right">
                                  <button type="button" onClick={() => retirerRubriqueDeCorps(corpsIndex, r.rubrique_paie_code)} className="opacity-60 hover:opacity-100">×</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <SelecteurRubriques
                      options={rubriquesDisponibles || []}
                      dejaAjoutees={
                        new Set([
                          ...corps.rubriques.map((r) => r.rubrique_paie_code),
                          ...(rubriquesDisponibles || [])
                            .filter((r) => !!rubriqueDejaUtiliseeCorps(r.code, corpsIndex))
                            .map((r) => r.code),
                        ])
                      }
                      onAjouter={(codes) => ajouterPlusieursRubriquesACorps(corpsIndex, codes)}
                    />
                  </div>

                  {/* Lignes spéciales */}
                  <div className="mt-3">
                    <p className="text-xs font-medium mb-2" style={{ color: "hsl(var(--foreground))" }}>
                      Lignes spéciales <span className="font-normal opacity-60">(totaux, constantes fixes)</span>
                    </p>
                    {corps.lignesSpeciales.map((ligne, ligneIndex) => (
                      <div key={ligneIndex} className="flex items-center gap-2 mb-1.5">
                        <div className="flex flex-col shrink-0">
                          <button type="button" disabled={ligneIndex === 0} onClick={() => deplacerLigneSpecialeDansCorps(corpsIndex, ligneIndex, -1)}
                            style={{ color: "hsl(var(--muted-foreground))", opacity: ligneIndex === 0 ? 0.3 : 1 }}>
                            <ChevronUp size={12} />
                          </button>
                          <button type="button" disabled={ligneIndex === corps.lignesSpeciales.length - 1} onClick={() => deplacerLigneSpecialeDansCorps(corpsIndex, ligneIndex, 1)}
                            style={{ color: "hsl(var(--muted-foreground))", opacity: ligneIndex === corps.lignesSpeciales.length - 1 ? 0.3 : 1 }}>
                            <ChevronDown size={12} />
                          </button>
                        </div>
                        <Input
                          value={ligne.code_constante}
                          onChange={(e) => majLigneSpeciale(corpsIndex, ligneIndex, "code_constante", e.target.value)}
                          placeholder="Code constante"
                          className="w-40 text-xs h-8"
                        />
                        <Input
                          value={ligne.libelle}
                          onChange={(e) => majLigneSpeciale(corpsIndex, ligneIndex, "libelle", e.target.value)}
                          placeholder="Libellé affiché"
                          className="flex-1 text-xs h-8"
                        />
                        <select
                          value={ligne.code_colonne}
                          onChange={(e) => majLigneSpeciale(corpsIndex, ligneIndex, "code_colonne", e.target.value)}
                          className="text-xs rounded border px-1.5 py-1.5 h-8"
                          style={{ borderColor: "hsl(var(--border))", background: "transparent" }}
                        >
                          <option value="">Colonne —</option>
                          {corps.colonnes.map((col) => (
                            <option key={col.code_colonne} value={col.code_colonne}>{col.libelle}</option>
                          ))}
                        </select>
                        <button type="button" onClick={() => supprimerLigneSpeciale(corpsIndex, ligneIndex)} className="opacity-60 hover:opacity-100 text-xs shrink-0">×</button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => ajouterLigneSpeciale(corpsIndex)}
                      className="text-xs mt-1"
                      style={{ color: "hsl(var(--primary))" }}
                    >
                      + Ajouter une ligne spéciale
                    </button>
                  </div>

                  {/* Blocs (regroupement visuel des rubriques de ce corps) */}
                  <div className="mt-4 pt-3" style={{ borderTop: "1px dashed hsl(var(--border))" }}>
                    <p className="text-xs font-medium mb-1" style={{ color: "hsl(var(--foreground))" }}>
                      Blocs <span className="font-normal opacity-60">(regroupement visuel des rubriques ci-dessus)</span>
                    </p>
                    {corps.blocs.map((bloc, blocIndex) => (
                      <div key={bloc.id || `nouveau-bloc-${blocIndex}`} className="rounded-lg border p-3 mb-2" style={{ borderColor: "hsl(var(--border))" }}>
                        <div className="flex items-center gap-2 mb-2">
                          <Input
                            value={bloc.libelle}
                            onChange={(e) => majBlocDansCorps(corpsIndex, blocIndex, "libelle", e.target.value)}
                            className="flex-1 text-xs h-8"
                          />
                          <button
                            type="button"
                            onClick={() => majBlocDansCorps(corpsIndex, blocIndex, "visible", !bloc.visible)}
                            className="text-[11px] px-2 py-1 rounded-full shrink-0"
                            style={{
                              background: bloc.visible ? "hsl(142 71% 45% / 0.15)" : "hsl(var(--muted))",
                              color: bloc.visible ? "hsl(142 71% 35%)" : "hsl(var(--muted-foreground))",
                            }}
                          >
                            {bloc.visible ? "Visible" : "Masqué"}
                          </button>
                          <button
                            type="button"
                            onClick={() => supprimerBlocDeCorps(corpsIndex, blocIndex)}
                            className="text-[11px] px-2 py-1 rounded-full shrink-0"
                            style={{ background: "hsl(0 84% 60% / 0.1)", color: "hsl(0 70% 45%)" }}
                          >
                            Supprimer
                          </button>
                        </div>

                        {/* Style + positions */}
                        <div className="flex flex-wrap items-center gap-3 mb-2 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                          <label className="flex items-center gap-1.5">
                            Fond
                            <input type="color" value={bloc.couleur_fond || "#ffffff"} onChange={(e) => majBlocDansCorps(corpsIndex, blocIndex, "couleur_fond", e.target.value)} className="w-6 h-6 rounded border-0 cursor-pointer" />
                          </label>
                          <label className="flex items-center gap-1.5">
                            Texte
                            <input type="color" value={bloc.couleur_texte || "#000000"} onChange={(e) => majBlocDansCorps(corpsIndex, blocIndex, "couleur_texte", e.target.value)} className="w-6 h-6 rounded border-0 cursor-pointer" />
                          </label>
                          <label className="flex items-center gap-1.5">
                            <input type="checkbox" checked={bloc.gras} onChange={(e) => majBlocDansCorps(corpsIndex, blocIndex, "gras", e.target.checked)} />
                            Gras
                          </label>
                          <label className="flex items-center gap-1.5">
                            Libellé
                            <select
                              value={bloc.position_libelle}
                              onChange={(e) => majBlocDansCorps(corpsIndex, blocIndex, "position_libelle", e.target.value as PositionLibelleBloc)}
                              className="text-xs rounded border px-1.5 py-1"
                              style={{ borderColor: "hsl(var(--border))", background: "transparent" }}
                            >
                              <option value="DEBUT">Début</option>
                              <option value="FIN">Fin</option>
                              <option value="AUCUN">Aucun</option>
                            </select>
                          </label>
                          <label className="flex items-center gap-1.5">
                            Total
                            <select
                              value={bloc.position_total}
                              onChange={(e) => majBlocDansCorps(corpsIndex, blocIndex, "position_total", e.target.value as PositionTotalBloc)}
                              className="text-xs rounded border px-1.5 py-1"
                              style={{ borderColor: "hsl(var(--border))", background: "transparent" }}
                            >
                              <option value="AUCUN">Aucun</option>
                              <option value="HAUT">En haut</option>
                              <option value="BAS">En bas</option>
                            </select>
                          </label>
                        </div>

                        {/* Aperçu */}
                        <div
                          className="text-xs px-2 py-1.5 rounded mb-2"
                          style={{
                            background: bloc.couleur_fond || "hsl(var(--muted))",
                            color: bloc.couleur_texte || "hsl(var(--foreground))",
                            fontWeight: bloc.gras ? 700 : 400,
                          }}
                        >
                          Aperçu — {bloc.libelle}
                        </div>

                        {/* Rubriques du bloc (parmi celles du corps) */}
                        <div className="mb-2">
                          <p className="text-[11px] mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Rubriques de ce bloc</p>
                          <div className="flex flex-wrap gap-1">
                            {corps.rubriques.map((r) => {
                              const dansCeBloc = bloc.rubriques.includes(r.rubrique_paie_code);
                              const autreBloc = !dansCeBloc ? rubriqueDejaUtiliseeBloc(corpsIndex, r.rubrique_paie_code, blocIndex) : null;
                              return (
                                <button
                                  type="button"
                                  key={r.rubrique_paie_code}
                                  disabled={!!autreBloc}
                                  onClick={() => toggleRubriqueDansBloc(corpsIndex, blocIndex, r.rubrique_paie_code)}
                                  title={autreBloc ? `Déjà dans « ${autreBloc} »` : undefined}
                                  className="text-[11px] px-2 py-0.5 rounded-full"
                                  style={{
                                    background: dansCeBloc ? "hsl(var(--primary))" : "hsl(var(--muted))",
                                    color: dansCeBloc ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
                                    opacity: autreBloc ? 0.4 : 1,
                                    cursor: autreBloc ? "not-allowed" : "pointer",
                                  }}
                                >
                                  {r.libelle}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Colonnes totalisées (au choix) */}
                        {bloc.position_total !== "AUCUN" && (
                          <div>
                            <p className="text-[11px] mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Colonnes totalisées</p>
                            <div className="flex flex-wrap gap-1">
                              {corps.colonnes.map((col) => {
                                const active = bloc.colonnesTotal.includes(col.code_colonne);
                                return (
                                  <button
                                    type="button"
                                    key={col.code_colonne}
                                    onClick={() => toggleColonneTotalDansBloc(corpsIndex, blocIndex, col.code_colonne)}
                                    className="text-[11px] px-2 py-0.5 rounded-full"
                                    style={{
                                      background: active ? "hsl(var(--primary))" : "hsl(var(--muted))",
                                      color: active ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
                                    }}
                                  >
                                    {col.libelle}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => ajouterBlocDansCorps(corpsIndex)}>
                      + Nouveau bloc
                    </Button>
                  </div>
                </div>
              ))}

              <Button variant="outline" onClick={ajouterCorps} className="gap-1.5">
                + Nouveau corps
              </Button>
            </>
          )}
        </div>
      )}

      {/* ── Étape 4 : Mise en forme ── */}
      {etape === 4 && (
        <div className="space-y-4 max-w-3xl">
          <div className="rounded-2xl border p-4 flex items-center justify-between" style={{ borderColor: "hsl(var(--border))" }}>
            <div>
              <p className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>Afficher le logo société</p>
              <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                Bascule automatiquement vers un en-tête texte si désactivé.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAfficherLogo((v) => !v)}
              className="w-10 h-[22px] rounded-full relative shrink-0"
              style={{ background: afficherLogo ? "hsl(var(--primary))" : "hsl(var(--muted))" }}
            >
              <span
                className="w-[18px] h-[18px] rounded-full absolute top-0.5 transition-all"
                style={{ background: "white", left: afficherLogo ? "20px" : "2px" }}
              />
            </button>
          </div>

          <div className="rounded-2xl border p-4" style={{ borderColor: "hsl(var(--border))" }}>
            <p className="text-sm font-medium mb-1" style={{ color: "hsl(var(--foreground))" }}>Pied de page</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {VARIABLES_PIED_DE_PAGE.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => inserer_variable(v)}
                  className="text-[11px] px-2 py-0.5 rounded-full font-mono"
                  style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}
                >
                  {v}
                </button>
              ))}
            </div>
            <textarea
              ref={pieddepageRef}
              value={piedDePage}
              onChange={(e) => setPiedDePage(e.target.value)}
              rows={2}
              placeholder="ex. {societe_nom} — Édité le {date_generation}"
              className="w-full text-sm rounded-md border px-3 py-2"
              style={{ borderColor: "hsl(var(--border))", background: "transparent", color: "hsl(var(--foreground))" }}
            />
          </div>

          {(modelesDisponibles || []).length > 0 && (
            <div>
              <label className="text-xs font-medium mb-2 block" style={{ color: "hsl(var(--muted-foreground))" }}>
                Modèle
              </label>
              <div className="flex flex-wrap gap-2">
                {(modelesDisponibles || []).map((mod) => (
                  <button
                    key={mod.code}
                    type="button"
                    onClick={() => setModeleCode(mod.code)}
                    className="text-sm px-3 py-1.5 rounded-full border"
                    style={{
                      borderColor: modeleCode === mod.code ? "hsl(var(--primary))" : "hsl(var(--border))",
                      background: modeleCode === mod.code ? "hsl(var(--primary) / 0.06)" : "transparent",
                      color: "hsl(var(--foreground))",
                    }}
                  >
                    {mod.libelle}
                  </button>
                ))}
              </div>
              <p className="text-[11px] mt-1.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                Régit la police, la densité et le style de présentation du document. Utilise l'aperçu pour comparer.
              </p>
            </div>
          )}

          <div>
            <label className="text-xs font-medium mb-2 block" style={{ color: "hsl(var(--muted-foreground))" }}>
              Format de sortie
            </label>
            <div className="flex gap-2">
              {(metadonnees?.formats_sortie || []).map((f) => (
                <button
                  key={f.code}
                  type="button"
                  onClick={() => setFormatSortie(f.code)}
                  className="text-sm px-3 py-1.5 rounded-full border"
                  style={{
                    borderColor: formatSortie === f.code ? "hsl(var(--primary))" : "hsl(var(--border))",
                    background: formatSortie === f.code ? "hsl(var(--primary) / 0.06)" : "transparent",
                    color: "hsl(var(--foreground))",
                  }}
                >
                  {f.libelle}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Étape 5 : Diffusion ── */}
      {etape === 5 && (
        <div className="space-y-4 max-w-3xl">
          <div>
            <label className="text-xs font-medium mb-2 block" style={{ color: "hsl(var(--muted-foreground))" }}>
              Visibilité
            </label>
            <div className="flex gap-2">
              {(metadonnees?.visibilites || []).map((v) => {
                const restreint = v.code !== "PRIVE" && !estAdmin;
                return (
                  <button
                    key={v.code}
                    type="button"
                    disabled={restreint}
                    onClick={() => setVisibilite(v.code)}
                    title={restreint ? "Réservé à un administrateur" : undefined}
                    className="text-sm px-3 py-1.5 rounded-full border"
                    style={{
                      borderColor: visibilite === v.code ? "hsl(var(--primary))" : "hsl(var(--border))",
                      background: visibilite === v.code ? "hsl(var(--primary) / 0.06)" : "transparent",
                      color: restreint ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))",
                      opacity: restreint ? 0.5 : 1,
                      cursor: restreint ? "not-allowed" : "pointer",
                    }}
                  >
                    {v.libelle}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border p-4" style={{ borderColor: "hsl(var(--border))" }}>
            <p className="text-sm font-medium mb-1" style={{ color: "hsl(var(--foreground))" }}>
              Écrans de lancement
            </p>
            <p className="text-xs mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
              Seuls les écrans compatibles avec le contexte requis par « {sourceChoisie?.libelle} » sont proposés.
            </p>
            {(ecransCompatibles || []).length === 0 ? (
              <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                Aucun écran compatible pour l'instant.
              </p>
            ) : (
              <div className="space-y-1">
                {ecransCompatibles.map((e) => (
                  <label key={e.code_ecran} className="flex items-center gap-2 py-1 text-sm cursor-pointer" style={{ color: "hsl(var(--foreground))" }}>
                    <input
                      type="checkbox"
                      checked={ecransSelectionnes.has(e.code_ecran)}
                      onChange={() => toggleEcran(e.code_ecran)}
                    />
                    {e.libelle}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Aperçu -- disponible uniquement en édition (état déjà créé) pour la source BULLETIN */}
      {enEdition && typeSource === "BULLETIN" && (
        <div className="rounded-2xl border p-4 max-w-3xl" style={{ borderColor: "hsl(var(--border))" }}>
          <p className="text-sm font-medium mb-1" style={{ color: "hsl(var(--foreground))" }}>Aperçu</p>
          <p className="text-xs mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
            Génère le vrai document PDF pour un collaborateur et une période donnés, avec les modifications non
            encore enregistrées de cette page.
          </p>

          {!collabSelectionne ? (
            <div className="relative max-w-sm">
              <Input
                value={rechercheCollab}
                onChange={(e) => setRechercheCollab(e.target.value)}
                placeholder="Rechercher par matricule ou nom…"
                className="text-sm h-9"
              />
              {rechercheCollab.trim().length >= 2 && (
                <div
                  className="absolute z-10 mt-1 w-full rounded-lg border shadow-sm max-h-56 overflow-auto"
                  style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))" }}
                >
                  {rechercheEnCours ? (
                    <div className="text-xs px-3 py-2 flex items-center gap-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                      <Loader2 size={12} className="animate-spin" /> Recherche…
                    </div>
                  ) : (collabResultats || []).length === 0 ? (
                    <div className="text-xs px-3 py-2" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun résultat.</div>
                  ) : (
                    (collabResultats || []).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => choisirCollaborateur(c)}
                        className="w-full text-left text-sm px-3 py-2 hover:bg-accent/10"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        <span className="font-mono text-xs mr-2" style={{ color: "hsl(var(--muted-foreground))" }}>{c.matricule}</span>
                        {c.nom} {c.prenom}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="px-2 py-1 rounded-full text-xs" style={{ background: "hsl(var(--muted))", color: "hsl(var(--foreground))" }}>
                  {collabSelectionne.matricule} — {collabSelectionne.nom} {collabSelectionne.prenom}
                </span>
                <button
                  type="button"
                  onClick={() => { setCollabSelectionne(null); setCollabApercu(""); setBulletinSelectionneId(""); setPeriodeApercu(""); }}
                  className="text-xs"
                  style={{ color: "hsl(var(--primary))" }}
                >
                  Changer
                </button>
              </div>

              {!bulletinsDisponibles ? (
                <div className="text-xs flex items-center gap-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                  <Loader2 size={12} className="animate-spin" /> Chargement des bulletins…
                </div>
              ) : bulletinsDisponibles.length === 0 ? (
                <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Aucun bulletin calculé pour ce collaborateur.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {bulletinsDisponibles.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => choisirBulletin(b)}
                      className="text-xs px-3 py-1.5 rounded-full border"
                      style={{
                        borderColor: bulletinSelectionneId === b.id ? "hsl(var(--primary))" : "hsl(var(--border))",
                        background: bulletinSelectionneId === b.id ? "hsl(var(--primary) / 0.08)" : "transparent",
                        color: "hsl(var(--foreground))",
                      }}
                    >
                      {b.date_reference ? new Date(b.date_reference).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) : "Période inconnue"}
                      {b.code_plan ? ` · ${b.code_plan}` : ""}
                      <span className="opacity-60"> · {b.statut}</span>
                    </button>
                  ))}
                </div>
              )}

              <Button size="sm" disabled={generationApercu || !periodeApercu} onClick={genererApercu} className="gap-1.5 h-8">
                {generationApercu ? <Loader2 size={14} className="animate-spin" /> : null}
                Générer l'aperçu (PDF)
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button variant="outline" disabled={etape === 1} onClick={() => setEtape((e) => e - 1)} className="gap-1.5">
          <ArrowLeft size={14} /> Précédent
        </Button>
        {etape < 4 ? (
          <Button disabled={!etapeValide(etape)} onClick={() => setEtape((e) => e + 1)} className="gap-1.5">
            Suivant <ArrowRight size={14} />
          </Button>
        ) : (
          <Button disabled={soumission} onClick={creer} className="gap-1.5">
            {soumission ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {enEdition ? "Enregistrer les modifications" : "Créer l'état"}
          </Button>
        )}
      </div>
      </>
      )}
    </div>
  );
}
