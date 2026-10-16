/**
 * PopulationsPaiePage — Gestion des populations de collaborateurs
 * (RG-POPULATION-RUBRIQUE-01), utilisées pour restreindre le calcul de
 * certaines rubriques à une partie des collaborateurs.
 * Auteur : Adil DAIA
 *
 * Deux modes de définition, au choix :
 *   - Critères : mêmes filtres que le lancement de paie (Organisation/UO,
 *     Poste, Type de contrat, Statut, Régime de cotisation).
 *   - SQL : une expression booléenne (validée côté serveur avant
 *     enregistrement — pas une requête libre).
 *
 * L'attribution rubrique ↔ population se fait depuis la fiche de la
 * rubrique (RubriqueForm.tsx), pas depuis cet écran — ici on ne fait que
 * définir/tester les populations elles-mêmes.
 */
import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Plus, Pencil, Copy, Archive, Loader2, ChevronsUpDown, Users, Code2, ListFilter,
  CheckCircle2, XCircle, ArrowLeft, Eye, Trash2, ChevronUp, ChevronDown, RotateCcw,
} from "lucide-react";
import { db, api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Opt = { value: string; label: string };
type Mode = "CRITERES" | "SQL";

interface PopulationCriteres {
  unite_ids: string[]; codes_poste: string[]; types_contrat: string[];
  statuts_contrat: string[]; temps: string[]; statuts_collaborateur: string[];
  regimes: string[]; nationalites: string[];
  // RG-POPULATION-RUBRIQUE-03 (Adil DAIA) : classification (collaborateur_qualifications)
  codes_fonction: string[]; codes_categorie_professionnelle: string[]; codes_college: string[];
  codes_responsabilite: string[]; codes_niveau: string[]; codes_grade: string[];
  codes_echelle: string[]; codes_classe: string[]; echelons: string[];
  codes_filiere: string[]; codes_activite: string[];
}
interface Population {
  id: string; code: string; libelle: string; mode: Mode;
  criteres: PopulationCriteres; condition_sql: string | null;
  actif: boolean; archive: boolean; nb_rubriques: number; nb_retirees: number;
}
type Collaborateur = { id: string; matricule?: string; nom?: string; prenom?: string };

const CRITERES_VIDES: PopulationCriteres = {
  unite_ids: [], codes_poste: [], types_contrat: [], statuts_contrat: [],
  temps: [], statuts_collaborateur: [], regimes: [], nationalites: [],
  codes_fonction: [], codes_categorie_professionnelle: [], codes_college: [],
  codes_responsabilite: [], codes_niveau: [], codes_grade: [], codes_echelle: [],
  codes_classe: [], echelons: [], codes_filiere: [], codes_activite: [],
};

// RG-FIX-CRITERES-UNDEFINED-01 (24/08) : fusion CHAMP PAR CHAMP plutôt qu'un
// simple `population?.criteres ?? CRITERES_VIDES` global — ce dernier ne
// comble les trous QUE si `criteres` est entièrement absent. Si l'objet
// existe mais qu'UN champ précis (ex. unite_ids sur une population dont ce
// critère n'a jamais été renseigné en base, valeur NULL/absente du JSON) est
// null/undefined, il restait tel quel et MultiSelect plantait sur
// `value.length` (Cannot read properties of undefined). Chaque champ est
// donc individuellement remplacé par [] s'il n'est pas un tableau exploitable.
function normaliserCriteres(source: Partial<PopulationCriteres> | null | undefined): PopulationCriteres {
  const résultat = { ...CRITERES_VIDES };
  for (const cle of Object.keys(CRITERES_VIDES) as (keyof PopulationCriteres)[]) {
    const valeur = source?.[cle];
    résultat[cle] = Array.isArray(valeur) ? valeur : [];
  }
  return résultat;
}

// ---- Multi-select réutilisable (identique à LancementPaiePage.tsx) -------
function MultiSelect({ label, options, value, onChange, placeholder = "Tous" }: {
  label: string; options: Opt[]; value: string[]; onChange: (v: string[]) => void; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const resume = value.length === 0 ? placeholder : value.length === 1
    ? (options.find((o) => o.value === value[0])?.label ?? "1 sélectionné")
    : `${value.length} sélectionnés`;
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
            <span className={value.length ? "" : "text-muted-foreground"}>{resume}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command filter={(value, search) => value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0}>
            <CommandInput placeholder="Rechercher…" />
            <CommandList>
              <CommandEmpty>Aucun résultat.</CommandEmpty>
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem key={o.value} value={o.label} onSelect={() => toggle(o.value)}>
                    <Checkbox checked={value.includes(o.value)} className="mr-2 pointer-events-none" />
                    {o.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Combobox rubriques : recherche + cases à cocher, branché directement sur
 * ajouterRubrique/basculerSuppression — cocher ajoute une ligne, décocher la
 * retire (ou l'annule si elle n'a jamais été enregistrée). Remplace le
 * <select> natif qui obligeait à faire défiler des dizaines de rubriques
 * sans pouvoir filtrer. */
function SelecteurRubriques({ rubriques, lignes, onAjouter, onRetirer }: {
  rubriques: { code: string; libelle: string }[];
  lignes: { code: string; etat: "EXISTANTE" | "NOUVELLE" | "SUPPRIMEE" }[];
  onAjouter: (code: string) => void;
  onRetirer: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const estCoche = (code: string) => lignes.some((l) => l.code === code && l.etat !== "SUPPRIMEE");
  const nbCoches = lignes.filter((l) => l.etat !== "SUPPRIMEE").length;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full sm:w-96 justify-between font-normal">
          <span className="text-muted-foreground">+ Ajouter une rubrique… {nbCoches > 0 && `(${nbCoches} sélectionnée${nbCoches > 1 ? "s" : ""})`}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command filter={(value, search) => value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0}>
          <CommandInput placeholder="Rechercher une rubrique (code ou libellé)…" />
          <CommandList className="max-h-72">
            <CommandEmpty>Aucun résultat.</CommandEmpty>
            <CommandGroup>
              {rubriques.map((r) => (
                <CommandItem
                  key={r.code}
                  value={`${r.code} ${r.libelle}`}
                  onSelect={() => (estCoche(r.code) ? onRetirer(r.code) : onAjouter(r.code))}
                >
                  <Checkbox checked={estCoche(r.code)} className="mr-2 pointer-events-none shrink-0" />
                  <span className="font-mono text-xs text-accent mr-1.5 shrink-0">{r.code}</span>
                  <span className="text-muted-foreground truncate">{r.libelle}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}


function arbreUo(rows: any[]): Opt[] {
  const enfants = new Map<string | null, any[]>();
  rows.forEach((u) => {
    const k = u.parent_id ?? null;
    if (!enfants.has(k)) enfants.set(k, []);
    enfants.get(k)!.push(u);
  });
  enfants.forEach((L) => L.sort((a, b) => a.libelle.localeCompare(b.libelle)));
  const out: Opt[] = [];
  const descendre = (parent: string | null, prof: number) => {
    (enfants.get(parent) || []).forEach((u) => {
      out.push({ value: u.id, label: `${"\u00A0\u00A0".repeat(prof)}${prof ? "└ " : ""}${u.libelle}` });
      descendre(u.id, prof + 1);
    });
  };
  descendre(null, 0);
  const vus = new Set(out.map((o) => o.value));
  rows.filter((u) => !vus.has(u.id)).forEach((u) => out.push({ value: u.id, label: u.libelle }));
  return out;
}

// RG-POPULATION-SQL-AIDE-01 (Adil DAIA) : colonnes réelles de `collaborateurs`
// (confirmées par \d collaborateurs) — pas une liste inventée. Volontairement
// une sélection utile pour du filtrage de population, pas les ~30 colonnes.
const COLONNES_AIDE: { col: string; desc: string }[] = [
  { col: "c.matricule", desc: "Matricule" },
  { col: "c.nom", desc: "Nom" },
  { col: "c.prenom", desc: "Prénom" },
  { col: "c.civilite", desc: "Civilité (M., Mme…)" },
  { col: "c.date_naissance", desc: "Date de naissance" },
  { col: "c.code_genre", desc: "Code genre" },
  { col: "c.code_nationalite", desc: "Code nationalité" },
  { col: "c.statut_collaborateur", desc: "Statut du collaborateur" },
  { col: "c.code_situation_familiale", desc: "Situation familiale" },
  { col: "c.nb_enfants_a_charge", desc: "Nombre d'enfants à charge" },
  { col: "c.nb_personnes_a_charge", desc: "Nombre de personnes à charge" },
  { col: "c.nb_deductions_fiscales", desc: "Nombre de déductions fiscales" },
];

const EXEMPLES_SQL: { titre: string; code: string }[] = [
  { titre: "A des enfants à charge", code: "c.nb_enfants_a_charge > 0" },
  { titre: "Né(e) avant une date", code: "c.date_naissance < '1990-01-01'" },
  {
    titre: "Ancienneté ≥ 5 ans (via le contrat actif)",
    code: "EXISTS (SELECT 1 FROM collaborateur_contrats k WHERE k.collaborateur_id = c.id AND k.archive = false AND k.date_debut <= now() - interval '5 years' AND (k.date_fin IS NULL OR k.date_fin >= now()))",
  },
  { titre: "Situation familiale mariée", code: "c.code_situation_familiale = 'MARIE'" },
];

type Vue = { type: "liste" } | { type: "form"; population: Population | null };

// ---- Pavé accordéon maison — même composant que RubriqueForm.tsx, repris
// ici pour rester cohérent (chevron à gauche, rotation, style identique). --
function PaveAccordeon({ titre, extra, ouvert, onToggle, children }: {
  titre: string; extra?: React.ReactNode; ouvert: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <ChevronDown
          size={16}
          className="shrink-0 text-muted-foreground transition-transform duration-200"
          style={{ transform: ouvert ? "rotate(0deg)" : "rotate(-90deg)" }}
        />
        <span className="text-sm font-semibold text-foreground flex-1">{titre}</span>
        {extra}
      </button>
      {ouvert && <div className="px-4 pb-4 pt-1 border-t border-border">{children}</div>}
    </div>
  );
}

export default function PopulationsPaiePage() {
  const [vue, setVue] = useState<Vue>({ type: "liste" });
  const [populations, setPopulations] = useState<Population[]>([]);
  const [chargement, setChargement] = useState(true);

  const charger = () => {
    setChargement(true);
    api.get<Population[]>("/paie/populations")
      .then(setPopulations)
      .catch((e: any) => toast.error("Chargement impossible", { description: e.message }))
      .finally(() => setChargement(false));
  };
  useEffect(() => { charger(); }, []);

  return (
    <div className="p-6 space-y-4 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Populations de paie</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Groupes de collaborateurs réutilisables pour restreindre le calcul de certaines rubriques.
          </p>
        </div>
        {vue.type === "liste" && (
          <Button onClick={() => setVue({ type: "form", population: null })} className="gap-1.5">
            <Plus className="h-4 w-4" /> Nouvelle population
          </Button>
        )}
      </div>

      {vue.type === "liste" ? (
        <ListePopulations
          populations={populations}
          chargement={chargement}
          onEdit={(p) => setVue({ type: "form", population: p })}
          onDuplicate={async (p) => {
            const nouveauCode = window.prompt(`Code de la copie de « ${p.code} » ?`, `${p.code}_COPIE`);
            if (!nouveauCode) return;
            try {
              const creee = await api.post<Population>("/paie/populations", {
                code: nouveauCode.trim().toUpperCase(),
                libelle: `${p.libelle} (copie)`,
                mode: p.mode, criteres: p.criteres, condition_sql: p.condition_sql, actif: p.actif,
              });
              // Copie aussi les rubriques attribuées/retirées — le cœur de ce
              // qu'une population "fait", pas juste ses critères de ciblage.
              const lignes = await api.get<{ code_rubrique: string; type_attribution: "ATTRIBUEE" | "RETIREE" }[]>(
                `/paie/populations/${p.id}/rubriques`,
              );
              if (lignes.length > 0) {
                await api.patch(`/paie/populations/${creee.id}/rubriques`, { lignes });
              }
              toast.success("Population dupliquée");
              charger();
            } catch (e: any) {
              toast.error("Échec de la duplication", { description: e.message });
            }
          }}
          onArchive={async (p) => {
            if (!confirm(`Archiver la population « ${p.libelle} » ?\n\nLes rubriques qui lui étaient attribuées ne la retrouveront plus.`)) return;
            try {
              await api.delete(`/paie/populations/${p.id}`);
              toast.success("Population archivée");
              charger();
            } catch (e: any) {
              toast.error("Échec de l'archivage", { description: e.message });
            }
          }}
        />
      ) : (
        <FormPopulation
          population={vue.population}
          onBack={() => setVue({ type: "liste" })}
          onSaved={(sauvegardee, etaitNouvelle) => {
            charger();
            if (etaitNouvelle) {
              // RG-POPULATION-RUBRIQUE-02 (Adil DAIA) : rester sur le
              // formulaire, désormais en mode édition — sinon la carte
              // "Rubriques attribuées" (masquée pour une population qui
              // n'existe pas encore) reste hors d'atteinte juste après la
              // création, obligeant à ressortir puis rouvrir la population.
              setVue({ type: "form", population: sauvegardee });
              toast.message("Vous pouvez maintenant lui attribuer des rubriques ci-dessous.");
            } else {
              setVue({ type: "liste" });
            }
          }}
        />
      )}
    </div>
  );
}

// ============================ Liste ========================================
function ListePopulations({ populations, chargement, onEdit, onDuplicate, onArchive }: {
  populations: Population[]; chargement: boolean;
  onEdit: (p: Population) => void; onDuplicate: (p: Population) => void; onArchive: (p: Population) => void;
}) {
  if (chargement) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (populations.length === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground py-16 border border-dashed rounded-lg">
        Aucune population — la population « Tous les collaborateurs » est créée automatiquement au déploiement.
      </div>
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Libellé</TableHead>
              <TableHead className="text-center">Mode</TableHead>
              <TableHead className="text-center">Rubriques attribuées</TableHead>
              <TableHead className="text-center">Actif</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {populations.map((p) => (
              <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => onEdit(p)}>
                <TableCell className="font-mono font-medium">{p.code}</TableCell>
                <TableCell>{p.libelle}</TableCell>
                <TableCell className="text-center">
                  <span
                    className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
                    style={
                      p.mode === "SQL"
                        ? { background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }
                        : { background: "hsl(var(--info) / 0.12)", color: "hsl(var(--info))" }
                    }
                  >
                    {p.mode === "SQL" ? <Code2 className="h-3 w-3" /> : <ListFilter className="h-3 w-3" />}
                    {p.mode === "SQL" ? "SQL" : "Critères"}
                  </span>
                </TableCell>
                <TableCell className="text-center">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: "hsl(var(--success) / 0.12)", color: "hsl(var(--success))" }}
                      title="Rubriques attribuées"
                    >
                      {p.nb_rubriques}
                    </span>
                    {p.nb_retirees > 0 && (
                      <span
                        className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: "hsl(var(--destructive) / 0.12)", color: "hsl(var(--destructive))" }}
                        title="Rubriques retirées"
                      >
                        −{p.nb_retirees}
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-center">
                  {p.actif
                    ? <CheckCircle2 className="h-4 w-4 inline" style={{ color: "hsl(var(--success))" }} />
                    : <XCircle className="h-4 w-4 inline text-muted-foreground" />}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(p)} title="Modifier">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onDuplicate(p)} title="Dupliquer">
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onArchive(p)} title="Archiver">
                      <Archive className="h-3.5 w-3.5" style={{ color: "hsl(var(--destructive))" }} />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ============================ Formulaire ===================================
function FormPopulation({ population, onBack, onSaved }: {
  population: Population | null; onBack: () => void; onSaved: (sauvegardee: Population, etaitNouvelle: boolean) => void;
}) {
  const estNouveau = !population;
  const [code, setCode] = useState(population?.code ?? "");
  const [libelle, setLibelle] = useState(population?.libelle ?? "");
  const [mode, setMode] = useState<Mode>(population?.mode ?? "CRITERES");
  const [criteres, setCriteres] = useState<PopulationCriteres>(normaliserCriteres(population?.criteres));
  const [conditionSql, setConditionSql] = useState(population?.condition_sql ?? "");
  const [actif, setActif] = useState(population?.actif ?? true);

  const [orgs, setOrgs] = useState<Opt[]>([]);
  const [postes, setPostes] = useState<Opt[]>([]);
  const [typesContrat, setTypesContrat] = useState<Opt[]>([]);
  const [statutsCollab, setStatutsCollab] = useState<Opt[]>([]);
  const [regimes, setRegimes] = useState<Opt[]>([]);
  // RG-POPULATION-RUBRIQUE-03 (Adil DAIA) : classification
  const [fonctions, setFonctions] = useState<Opt[]>([]);
  const [categoriesPro, setCategoriesPro] = useState<Opt[]>([]);
  const [colleges, setColleges] = useState<Opt[]>([]);
  const [responsabilites, setResponsabilites] = useState<Opt[]>([]);
  const [niveaux, setNiveaux] = useState<Opt[]>([]);
  const [grades, setGrades] = useState<Opt[]>([]);
  const [echelles, setEchelles] = useState<Opt[]>([]);
  const [classes, setClasses] = useState<Opt[]>([]);
  const [filieres, setFilieres] = useState<Opt[]>([]);
  const [activites, setActivites] = useState<Opt[]>([]);
  const [refsChargees, setRefsChargees] = useState(false);

  const [validationSql, setValidationSql] = useState<{ ok: boolean; erreur?: string | null } | null>(null);
  const [testEnCours, setTestEnCours] = useState(false);
  const [apercu, setApercu] = useState<Collaborateur[] | null>(null);
  const [apercuEnCours, setApercuEnCours] = useState(false);
  const [enregistrement, setEnregistrement] = useState(false);
  const [pavesOuverts, setPavesOuverts] = useState<Set<string>>(new Set(["mode", "rubriques"]));
  const togglePave = (cle: string) => setPavesOuverts((prev) => {
    const n = new Set(prev);
    n.has(cle) ? n.delete(cle) : n.add(cle);
    return n;
  });

  // RG-POPULATION-RUBRIQUE-02 (Adil DAIA) : c'est ICI, depuis la population,
  // qu'on attribue les rubriques — pas l'inverse. Une rubrique peut
  // appartenir à plusieurs populations gérées par des personnes différentes ;
  // éditer l'attribution depuis la fiche rubrique risquait de la retirer par
  // erreur d'une population à laquelle quelqu'un d'autre l'avait rattachée.
  //
  // RG-POPULATION-RUBRIQUE-04 (Adil DAIA) : deux notions bien distinctes par
  // ligne — `type` (ATTRIBUEE/RETIREE, persistant, choisi par l'utilisateur —
  // une population peut aussi bien accorder une rubrique QUE la retirer
  // explicitement ; le retrait prime sur toute autre population qui
  // l'accorderait, voir rubriques_eligibles() côté serveur) et `etat`
  // (EXISTANTE/NOUVELLE/SUPPRIMEE, transitoire — pour visualiser le diff
  // avant d'enregistrer, sans rapport avec le type choisi).
  const [rubriquesDisponibles, setRubriquesDisponibles] = useState<{ code: string; libelle: string; code_type: string | null }[]>([]);
  const [lignesRubriques, setLignesRubriques] = useState<{ code: string; type: "ATTRIBUEE" | "RETIREE"; etat: "EXISTANTE" | "NOUVELLE" | "SUPPRIMEE" }[]>([]);
  const [chargementRubriques, setChargementRubriques] = useState(false);
  const [enregistrementRubriques, setEnregistrementRubriques] = useState(false);
  const [triRubriques, setTriRubriques] = useState<{ col: "code" | "libelle" | "type"; dir: "asc" | "desc" }>({ col: "code", dir: "asc" });

  useEffect(() => {
    // RG-POPULATION-RUBRIQUE-05 (Adil DAIA) : les assiettes (code_type = 'ASS')
    // ne doivent jamais apparaître ici — elles s'accumulent automatiquement
    // dès qu'une rubrique éligible qui les alimente est calculée
    // (paie_engine.py les exclut déjà du filtre d'éligibilité), leur
    // attribuer ou les retirer d'une population n'a aucun sens. Filtré côté
    // client (pas de filtre "not equal" confirmé sur l'API générique /db/).
    db.list<{ code: string; libelle: string; code_type: string | null }>(
      "rubrique_paie", { select: "code,libelle,code_type", archive: false, order: "code", limit: 2000 },
    )
      .then((rows) => setRubriquesDisponibles(rows.filter((r) => r.code_type !== "ASS")))
      .catch(() => { /* repli silencieux */ });
  }, []);

  useEffect(() => {
    if (estNouveau) { setLignesRubriques([]); return; }
    setChargementRubriques(true);
    api.get<{ code_rubrique: string; type_attribution: "ATTRIBUEE" | "RETIREE" }[]>(`/paie/populations/${population!.id}/rubriques`)
      .then((lignes) => setLignesRubriques(lignes.map((l) => ({ code: l.code_rubrique, type: l.type_attribution, etat: "EXISTANTE" as const }))))
      .catch(() => { /* repli silencieux */ })
      .finally(() => setChargementRubriques(false));
  }, [estNouveau, population?.id]);

  // Marque/démarque une ligne pour suppression (annulable avant l'enregistrement).
  const basculerSuppression = (code: string) => {
    setLignesRubriques((lignes) => lignes
      // Une ligne NOUVELLE (jamais enregistrée) disparaît complètement —
      // rien à "supprimer" formellement, elle n'a jamais existé côté serveur.
      .filter((l) => !(l.code === code && l.etat === "NOUVELLE"))
      .map((l) => l.code === code ? { ...l, etat: l.etat === "SUPPRIMEE" ? "EXISTANTE" : "SUPPRIMEE" } : l));
  };

  // Change le type (ATTRIBUEE/RETIREE) d'une ligne — indépendant de son état.
  const changerType = (code: string, type: "ATTRIBUEE" | "RETIREE") => {
    setLignesRubriques((lignes) => lignes.map((l) => l.code === code ? { ...l, type } : l));
  };

  const ajouterRubrique = (code: string) => {
    setLignesRubriques((lignes) => {
      // Déjà présente en SUPPRIMEE (retirée de la liste puis rajoutée sans
      // avoir encore enregistré) : on la restaure plutôt que de créer une
      // ligne en double.
      if (lignes.some((l) => l.code === code)) {
        return lignes.map((l) => l.code === code ? { ...l, etat: "EXISTANTE" as const } : l);
      }
      return [...lignes, { code, type: "ATTRIBUEE" as const, etat: "NOUVELLE" as const }];
    });
  };

  const lignesTriees = [...lignesRubriques].sort((a, b) => {
    const libA = rubriquesDisponibles.find((r) => r.code === a.code)?.libelle ?? "";
    const libB = rubriquesDisponibles.find((r) => r.code === b.code)?.libelle ?? "";
    const va = triRubriques.col === "code" ? a.code : triRubriques.col === "libelle" ? libA : a.type;
    const vb = triRubriques.col === "code" ? b.code : triRubriques.col === "libelle" ? libB : b.type;
    return (triRubriques.dir === "asc" ? 1 : -1) * va.localeCompare(vb, "fr");
  });

  const trierPar = (col: "code" | "libelle" | "type") =>
    setTriRubriques((t) => ({ col, dir: t.col === col && t.dir === "asc" ? "desc" : "asc" }));

  const enregistrerRubriques = async () => {
    if (estNouveau) return;
    setEnregistrementRubriques(true);
    try {
      const lignesRetenues = lignesRubriques.filter((l) => l.etat !== "SUPPRIMEE").map((l) => ({ code_rubrique: l.code, type_attribution: l.type }));
      await api.patch(`/paie/populations/${population!.id}/rubriques`, { lignes: lignesRetenues });
      // Après enregistrement, toutes les lignes restantes redeviennent
      // EXISTANTE (les SUPPRIMEE ont disparu, les NOUVELLE sont confirmées).
      setLignesRubriques(lignesRetenues.map((l) => ({ code: l.code_rubrique, type: l.type_attribution, etat: "EXISTANTE" as const })));
      toast.success("Rubriques attribuées enregistrées");
    } catch (e: any) {
      toast.error("Échec de l'enregistrement", { description: e.message });
    } finally {
      setEnregistrementRubriques(false);
    }
  };

  useEffect(() => {
    const opt = (rows: any[], v: string, l: string) => rows.map((r) => ({ value: r[v], label: r[l] ?? r[v] }));
    Promise.allSettled([
      db.list<any>("unites_organisationnelles", { select: "id,libelle,parent_id", actif: true, order: "libelle", limit: 2000 }),
      db.list<any>("ref_poste", { select: "code,libelle", actif: true, order: "libelle", limit: 2000 }),
      db.list<any>("ref_type_contrat", { select: "code,libelle", limit: 200 }),
      db.list<any>("ref_statut_collaborateur", { select: "code,libelle", limit: 200 }),
      db.list<any>("ref_regime_cotisation", { select: "code,libelle", limit: 200 }),
      // RG-POPULATION-RUBRIQUE-03 : classification (collaborateur_qualifications)
      db.list<any>("ref_fonction", { select: "code,libelle", actif: true, order: "libelle", limit: 500 }),
      db.list<any>("ref_categorie_professionnelle", { select: "code,libelle", actif: true, order: "libelle", limit: 500 }),
      db.list<any>("ref_college", { select: "code,libelle", actif: true, order: "libelle", limit: 500 }),
      db.list<any>("ref_responsabilite", { select: "code,libelle", actif: true, order: "libelle", limit: 500 }),
      // ⚠️ Hypothèse à confirmer : 3 tables "niveau" existent (qualification/
      // compétence/diplôme) — celle-ci suppose que code_niveau sur
      // collaborateur_qualifications référence ref_niveau_qualification.
      db.list<any>("ref_niveau_qualification", { select: "code,libelle", actif: true, order: "ordre", limit: 500 }),
      db.list<any>("ref_grade", { select: "code,libelle", actif: true, order: "libelle", limit: 500 }),
      db.list<any>("ref_echelle", { select: "code,libelle", actif: true, order: "libelle", limit: 500 }),
      db.list<any>("ref_classe", { select: "code,libelle", actif: true, order: "libelle", limit: 500 }),
      db.list<any>("ref_filiere", { select: "code,libelle", actif: true, order: "libelle", limit: 500 }),
      db.list<any>("ref_activite", { select: "code,libelle", actif: true, order: "libelle", limit: 500 }),
    ]).then((r) => {
      if (r[0].status === "fulfilled") setOrgs(arbreUo(r[0].value));
      if (r[1].status === "fulfilled") setPostes(opt(r[1].value, "code", "libelle"));
      if (r[2].status === "fulfilled") setTypesContrat(opt(r[2].value, "code", "libelle"));
      if (r[3].status === "fulfilled") setStatutsCollab(opt(r[3].value, "code", "libelle"));
      if (r[4].status === "fulfilled") setRegimes(opt(r[4].value, "code", "libelle"));
      if (r[5].status === "fulfilled") setFonctions(opt(r[5].value, "code", "libelle"));
      if (r[6].status === "fulfilled") setCategoriesPro(opt(r[6].value, "code", "libelle"));
      if (r[7].status === "fulfilled") setColleges(opt(r[7].value, "code", "libelle"));
      if (r[8].status === "fulfilled") setResponsabilites(opt(r[8].value, "code", "libelle"));
      if (r[9].status === "fulfilled") setNiveaux(opt(r[9].value, "code", "libelle"));
      if (r[10].status === "fulfilled") setGrades(opt(r[10].value, "code", "libelle"));
      if (r[11].status === "fulfilled") setEchelles(opt(r[11].value, "code", "libelle"));
      if (r[12].status === "fulfilled") setClasses(opt(r[12].value, "code", "libelle"));
      if (r[13].status === "fulfilled") setFilieres(opt(r[13].value, "code", "libelle"));
      if (r[14].status === "fulfilled") setActivites(opt(r[14].value, "code", "libelle"));
      setRefsChargees(true);
    });
  }, []);

  const sqlRef = useRef<HTMLTextAreaElement>(null);
  const insererDansSql = (texte: string) => {
    const el = sqlRef.current;
    if (!el) { setConditionSql((v) => (v ? `${v} ${texte}` : texte)); return; }
    const debut = el.selectionStart ?? conditionSql.length;
    const fin = el.selectionEnd ?? conditionSql.length;
    const next = conditionSql.slice(0, debut) + texte + conditionSql.slice(fin);
    setConditionSql(next);
    setValidationSql(null);
    const pos = debut + texte.length;
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); });
  };

  const testerSql = async () => {
    if (!conditionSql.trim()) { setValidationSql({ ok: false, erreur: "Condition vide" }); return; }
    setTestEnCours(true);
    try {
      const res = await api.post<{ ok: boolean; erreur: string | null }>(
        `/paie/populations/valider-sql?condition_sql=${encodeURIComponent(conditionSql)}`, {},
      );
      setValidationSql(res);
    } catch (e: any) {
      setValidationSql({ ok: false, erreur: e.message });
    } finally {
      setTestEnCours(false);
    }
  };

  const voirApercu = async () => {
    if (mode === "SQL" && (!validationSql || !validationSql.ok)) {
      // On teste la syntaxe au passage si ce n'est pas déjà fait — évite un
      // aller-retour inutile pour l'utilisateur qui clique direct sur Aperçu.
      await testerSql();
    }
    setApercuEnCours(true);
    setApercu(null);
    try {
      // RG-POPULATION-APERCU-01 (Adil DAIA) : ne JAMAIS envoyer population_id
      // ici — le backend l'utilise pour relire la définition ENREGISTRÉE en
      // base et ignore alors mode/criteres du corps de la requête. "Voir qui
      // correspond" doit toujours tester ce qui est affiché à l'écran, y
      // compris une modification pas encore enregistrée (bug rencontré :
      // critère coché à l'écran, aperçu à 0 car il relisait l'ancienne
      // définition enregistrée).
      const res = await api.post<Collaborateur[]>("/paie/populations/apercu", {
        mode, criteres, condition_sql: mode === "SQL" ? conditionSql : null,
      });
      setApercu(res);
    } catch (e: any) {
      toast.error("Aperçu impossible", { description: e.message });
    } finally {
      setApercuEnCours(false);
    }
  };

  const enregistrer = async () => {
    if (!code.trim() || !libelle.trim()) { toast.error("Code et libellé sont requis"); return; }
    if (mode === "SQL") {
      if (!conditionSql.trim()) { toast.error("La condition SQL est requise en mode SQL"); return; }
      // Revalidation systématique juste avant l'enregistrement — l'utilisateur
      // a pu modifier le texte après le dernier "Tester" sans le relancer.
      try {
        const res = await api.post<{ ok: boolean; erreur: string | null }>(
          `/paie/populations/valider-sql?condition_sql=${encodeURIComponent(conditionSql)}`, {},
        );
        setValidationSql(res);
        if (!res.ok) { toast.error("Condition SQL invalide", { description: res.erreur ?? undefined }); return; }
      } catch (e: any) {
        toast.error("Validation impossible", { description: e.message });
        return;
      }
    }
    setEnregistrement(true);
    const payload = { code: code.trim().toUpperCase(), libelle: libelle.trim(), mode, criteres, condition_sql: mode === "SQL" ? conditionSql : null, actif };
    try {
      const resultat = estNouveau
        ? await api.post<Population>("/paie/populations", payload)
        : await api.patch<Population>(`/paie/populations/${population!.id}`, payload);
      toast.success(estNouveau ? "Population créée" : "Population enregistrée");
      onSaved(resultat, estNouveau);
    } catch (e: any) {
      toast.error("Échec de l'enregistrement", { description: e.message });
    } finally {
      setEnregistrement(false);
    }
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3.5 w-3.5" /> Retour
      </button>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Code *</label>
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="EX. CADRES" className="font-mono" disabled={!estNouveau} />
              {!estNouveau && <p className="text-[11px] text-muted-foreground mt-1">Le code n'est plus modifiable après création.</p>}
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Libellé *</label>
              <Input value={libelle} onChange={(e) => setLibelle(e.target.value)} placeholder="Ex. Personnel cadre" />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox checked={actif} onCheckedChange={(v) => setActif(!!v)} /> Population active
            </label>
          </div>

          <PaveAccordeon titre="Mode de définition" ouvert={pavesOuverts.has("mode")} onToggle={() => togglePave("mode")}>
            <div className="mb-4">
            <div className="inline-flex rounded-lg border border-border overflow-hidden text-sm">
              {([["CRITERES", "Critères", ListFilter], ["SQL", "SQL", Code2]] as const).map(([val, lbl, Icon]) => (
                <button key={val} type="button" onClick={() => setMode(val)}
                  className="px-4 py-2 flex items-center gap-1.5 transition-colors"
                  style={mode === val ? { background: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" } : { color: "hsl(var(--muted-foreground))" }}
                >
                  <Icon className="h-3.5 w-3.5" /> {lbl}
                </button>
              ))}
            </div>
            </div>

          {mode === "CRITERES" ? (
            <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
              {!refsChargees ? (
                <div className="col-span-full flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
              ) : (
                <>
                  <MultiSelect label="Organisation / UO" options={orgs} value={criteres.unite_ids} onChange={(v) => setCriteres((c) => ({ ...c, unite_ids: v }))} />
                  <MultiSelect label="Poste" options={postes} value={criteres.codes_poste} onChange={(v) => setCriteres((c) => ({ ...c, codes_poste: v }))} />
                  <MultiSelect label="Type de contrat" options={typesContrat} value={criteres.types_contrat} onChange={(v) => setCriteres((c) => ({ ...c, types_contrat: v }))} />
                  <MultiSelect label="Statut collaborateur" options={statutsCollab} value={criteres.statuts_collaborateur} onChange={(v) => setCriteres((c) => ({ ...c, statuts_collaborateur: v }))} />
                  <MultiSelect label="Régime de cotisation" options={regimes} value={criteres.regimes} onChange={(v) => setCriteres((c) => ({ ...c, regimes: v }))} />
                </>
              )}
              <p className="col-span-full text-xs text-muted-foreground">
                Aucun critère coché dans une catégorie = pas de restriction sur cette catégorie. Tout vide = tous les collaborateurs.
              </p>
            </div>

            {refsChargees && (
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <h4 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "hsl(var(--accent))" }}>
                  Classification
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <MultiSelect label="Fonction" options={fonctions} value={criteres.codes_fonction} onChange={(v) => setCriteres((c) => ({ ...c, codes_fonction: v }))} />
                  <MultiSelect label="Catégorie professionnelle" options={categoriesPro} value={criteres.codes_categorie_professionnelle} onChange={(v) => setCriteres((c) => ({ ...c, codes_categorie_professionnelle: v }))} />
                  <MultiSelect label="Collège" options={colleges} value={criteres.codes_college} onChange={(v) => setCriteres((c) => ({ ...c, codes_college: v }))} />
                  <MultiSelect label="Responsabilité" options={responsabilites} value={criteres.codes_responsabilite} onChange={(v) => setCriteres((c) => ({ ...c, codes_responsabilite: v }))} />
                  <MultiSelect label="Niveau" options={niveaux} value={criteres.codes_niveau} onChange={(v) => setCriteres((c) => ({ ...c, codes_niveau: v }))} />
                  <MultiSelect label="Grade" options={grades} value={criteres.codes_grade} onChange={(v) => setCriteres((c) => ({ ...c, codes_grade: v }))} />
                  <MultiSelect label="Échelle" options={echelles} value={criteres.codes_echelle} onChange={(v) => setCriteres((c) => ({ ...c, codes_echelle: v }))} />
                  <MultiSelect label="Classe" options={classes} value={criteres.codes_classe} onChange={(v) => setCriteres((c) => ({ ...c, codes_classe: v }))} />
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Échelon</label>
                    <Input
                      value={criteres.echelons.join(", ")}
                      onChange={(e) => setCriteres((c) => ({ ...c, echelons: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }))}
                      placeholder="ex. 3A, 4B (séparés par une virgule)"
                    />
                    <p className="text-[11px] text-muted-foreground">Texte libre — aucun référentiel pour l'échelon.</p>
                  </div>
                  <MultiSelect label="Filière" options={filieres} value={criteres.codes_filiere} onChange={(v) => setCriteres((c) => ({ ...c, codes_filiere: v }))} />
                  <MultiSelect label="Activité" options={activites} value={criteres.codes_activite} onChange={(v) => setCriteres((c) => ({ ...c, codes_activite: v }))} />
                </div>
              </div>
            )}
            </>
          ) : (
            <div className="space-y-2 pt-2">
              <label className="text-sm font-medium block">Condition SQL (expression booléenne)</label>
              <Textarea
                ref={sqlRef}
                value={conditionSql}
                onChange={(e) => { setConditionSql(e.target.value); setValidationSql(null); }}
                placeholder="ex. c.statut_collaborateur = 'ACTIF' AND c.nb_enfants_a_charge > 0"
                className="font-mono text-sm min-h-[90px]"
              />
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={testerSql} disabled={testEnCours}>
                  {testEnCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Tester la syntaxe
                </Button>
                {validationSql && (
                  <span className="text-xs" style={{ color: validationSql.ok ? "hsl(var(--success))" : "hsl(var(--destructive))" }}>
                    {validationSql.ok ? "Syntaxe acceptée" : validationSql.erreur}
                  </span>
                )}
              </div>

              {/* RG-POPULATION-SQL-AIDE-01 (Adil DAIA) : aide à la saisie —
                  colonnes réelles de `collaborateurs` cliquables (insérées au
                  curseur, même principe que l'éditeur de règles de calcul),
                  plus quelques exemples prêts à l'emploi. */}
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Colonnes disponibles (cliquez pour insérer)
                </p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {COLONNES_AIDE.map((c) => (
                    <button key={c.col} type="button" onClick={() => insererDansSql(c.col)} title={c.desc}
                      className="text-[11px] font-mono px-2 py-1 rounded-md border border-border bg-background hover:border-accent/50 hover:text-accent transition-colors">
                      {c.col}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Exemples (cliquez pour insérer)
                </p>
                <div className="space-y-1">
                  {EXEMPLES_SQL.map((ex) => (
                    <button key={ex.titre} type="button" onClick={() => insererDansSql(ex.code)}
                      className="w-full text-left text-xs px-2 py-1.5 rounded-md border border-border bg-background hover:border-accent/50 transition-colors">
                      <span className="font-medium text-foreground">{ex.titre}</span>
                      <div className="font-mono text-[11px] text-muted-foreground truncate">{ex.code}</div>
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Une seule expression booléenne, évaluée pour la table <code className="text-accent">collaborateurs c</code> (ex.
                <code className="text-accent"> c.statut_collaborateur</code>, <code className="text-accent">c.nb_enfants_a_charge</code>…).
                Aucune modification de donnée n'est permise (lecture seule, mots-clés de modification/DDL rejetés).
              </p>
            </div>
          )}

          <div className="border-t border-border pt-4 flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={voirApercu} disabled={apercuEnCours} className="gap-1.5">
              {apercuEnCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
              Voir qui correspond
            </Button>
            {apercu !== null && (
              <span className="text-sm text-muted-foreground inline-flex items-center gap-1.5">
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: "hsl(var(--success) / 0.12)", color: "hsl(var(--success))" }}
                >
                  {apercu.length}
                </span>
                collaborateur(s) correspondant(s)
              </span>
            )}
          </div>
          {apercu !== null && apercu.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-lg border" style={{ borderColor: "hsl(var(--success) / 0.3)" }}>
              <ul className="divide-y divide-border text-sm">
                {apercu.map((c) => (
                  <li key={c.id} className="px-3 py-1.5 flex items-center gap-2" style={{ background: "hsl(var(--success) / 0.05)" }}>
                    <Users className="h-3 w-3 shrink-0" style={{ color: "hsl(var(--success))" }} />
                    <span className="font-mono text-xs text-muted-foreground">{c.matricule}</span>
                    <span className="text-foreground">{c.nom} {c.prenom}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          </PaveAccordeon>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="outline" onClick={onBack}>Annuler</Button>
            <Button onClick={enregistrer} disabled={enregistrement}>
              {enregistrement && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              {estNouveau ? "Créer" : "Enregistrer"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* RG-POPULATION-RUBRIQUE-02 : uniquement une fois la population créée
          (les tables d'attribution référencent son id). */}
      {!estNouveau && (
        <PaveAccordeon titre="Rubriques attribuées à cette population" ouvert={pavesOuverts.has("rubriques")} onToggle={() => togglePave("rubriques")}>
            <p className="text-xs text-muted-foreground mb-3">
              Une rubrique calculée pour cette population doit lui être attribuée ici — l'attribution se gère depuis la
              population, pas depuis la fiche de la rubrique, pour éviter de la retirer par erreur d'une autre population.
              Une ligne peut aussi bien <strong>attribuer</strong> une rubrique que la <strong>retirer</strong> explicitement —
              si un collaborateur appartient à une autre population qui l'accorderait, <strong>le retrait prime toujours</strong>.
            </p>

            {chargementRubriques ? (
              <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : (
              <>
                <div className="rounded-lg border border-border overflow-hidden mb-3">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50">
                        {([["code", "Code"], ["libelle", "Libellé"], ["type", "Type"]] as const).map(([col, label]) => (
                          <th key={col}
                            className={`px-3 py-2 text-left text-[11px] uppercase tracking-wide font-semibold text-muted-foreground cursor-pointer select-none ${col === "type" ? "text-center" : ""}`}
                            onClick={() => trierPar(col)}
                          >
                            <span className="inline-flex items-center gap-1">
                              {label}
                              {triRubriques.col === col && (triRubriques.dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                            </span>
                          </th>
                        ))}
                        <th className="px-3 py-2 text-center text-[11px] uppercase tracking-wide font-semibold text-muted-foreground w-24">État</th>
                        <th className="px-3 py-2 w-12" />
                      </tr>
                    </thead>
                    <tbody>
                      {lignesTriees.length === 0 && (
                        <tr><td colSpan={5} className="px-3 py-3 text-center text-xs text-muted-foreground italic">Aucune rubrique attribuée.</td></tr>
                      )}
                      {lignesTriees.map((ligne) => {
                        const r = rubriquesDisponibles.find((x) => x.code === ligne.code);
                        const supprimee = ligne.etat === "SUPPRIMEE";
                        const cfgEtat = ligne.etat === "EXISTANTE"
                          ? { label: "Inchangée", v: "--muted-foreground" }
                          : ligne.etat === "SUPPRIMEE"
                            ? { label: "À supprimer", v: "--destructive" }
                            : { label: "Nouvelle", v: "--info" };
                        return (
                          <tr key={ligne.code} className="border-t border-border">
                            <td className="px-3 py-1.5">
                              <span className={`font-mono text-xs ${supprimee ? "line-through text-muted-foreground" : "text-accent"}`}>{ligne.code}</span>
                            </td>
                            <td className={`px-3 py-1.5 ${supprimee ? "line-through text-muted-foreground" : "text-foreground"}`}>
                              {r?.libelle ?? "—"}
                            </td>
                            <td className="px-3 py-1.5 text-center">
                              {/* Type : Attribuée/Retirée — persistant, éditable même sur une
                                  ligne déjà existante (indépendant de l'état ci-dessous). */}
                              <div className="inline-flex rounded-md border border-border overflow-hidden text-[11px]">
                                {(["ATTRIBUEE", "RETIREE"] as const).map((t) => (
                                  <button key={t} type="button" disabled={supprimee}
                                    onClick={() => changerType(ligne.code, t)}
                                    className="px-2 py-1 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                    style={
                                      ligne.type === t
                                        ? { background: `hsl(var(${t === "ATTRIBUEE" ? "--success" : "--destructive"}))`, color: "#fff" }
                                        : { color: "hsl(var(--muted-foreground))" }
                                    }
                                  >
                                    {t === "ATTRIBUEE" ? "Attribuée" : "Retirée"}
                                  </button>
                                ))}
                              </div>
                            </td>
                            <td className="px-3 py-1.5 text-center">
                              <span
                                className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                                style={{ background: `hsl(var(${cfgEtat.v}) / 0.12)`, color: `hsl(var(${cfgEtat.v}))` }}
                              >
                                {cfgEtat.label}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-center">
                              <button onClick={() => basculerSuppression(ligne.code)}
                                className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
                                style={supprimee ? { color: "hsl(var(--success))" } : undefined}
                                onMouseEnter={(e) => { if (!supprimee) e.currentTarget.style.color = "hsl(var(--destructive))"; }}
                                onMouseLeave={(e) => { if (!supprimee) e.currentTarget.style.color = ""; }}
                                title={supprimee ? "Annuler la suppression" : "Supprimer cette ligne"}
                              >
                                {supprimee ? <RotateCcw className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mb-3">
                  <SelecteurRubriques
                    rubriques={rubriquesDisponibles}
                    lignes={lignesRubriques}
                    onAjouter={ajouterRubrique}
                    onRetirer={basculerSuppression}
                  />
                </div>

                <Button size="sm" onClick={enregistrerRubriques} disabled={enregistrementRubriques} className="gap-1.5">
                  {enregistrementRubriques && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Enregistrer les rubriques attribuées
                </Button>
              </>
            )}
        </PaveAccordeon>
      )}
    </div>
  );
}
