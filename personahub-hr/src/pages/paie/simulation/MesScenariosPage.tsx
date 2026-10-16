/**
 * src/pages/paie/simulation/MesScenariosPage.tsx
 * Route : /paie/traitement/simulation/scenarios
 *
 * Gestion des scénarios (liste, dupliquer, partager, archiver, exporter) +
 * création d'un NOUVEAU scénario orienté POPULATION (RG-SIM-SCENARIO-01,
 * proposition — Adil DAIA) : un scénario n'a pas besoin d'être rattaché à
 * un collaborateur précis — ce sont juste des surcharges, appliquées plus
 * tard à une population entière depuis l'écran de lancement en masse.
 *
 * Tri ENTIÈREMENT AUTO-SUFFISANT dans ce fichier (aucune dépendance vers un
 * hook/composant séparé) — après deux incidents où useSortableTable.ts/
 * EnTeteTriable.tsx (fichiers externes jamais réellement présents sur le
 * poste de déploiement) ont fait planter des écrans entiers, le tri est
 * réimplémenté ici même, comme sur SimulationPopulationPage.tsx.
 */
import { useEffect, useState } from "react";
import { Copy, Archive, Share2, FolderOpen, FileDown, Loader2, Plus, X, ChevronDown, FlaskConical, Users2, ListChecks, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableHeader, TableRow, TableCell, TableHead } from "@/components/ui/table";
import { db } from "@/lib/api";
import { EditeurSurcharges } from "@/components/paie/simulation/EditeurSurcharges";
import {
  listerScenarios,
  dupliquerScenario,
  archiverScenario,
  modifierScenario,
  creerScenario,
  lireScenario,
  exporterExcelSimulation,
  type ScenarioSimulation,
  type ModeSimulation,
  type SurchargeRubrique,
  type SurchargeTable,
  type SurchargeRegime,
} from "@/lib/simulation-api";
import { listerPopulationsCompletes, apercuPopulation, type PopulationPaieRead } from "@/lib/population-api";

const LIBELLES_TYPE: Record<ModeSimulation, string> = {
  BULLETIN: "Bulletin",
  IMPACT: "Impact",
  EMBAUCHE: "Embauche",
};

const CLASSES_TYPE: Record<ModeSimulation, string> = {
  BULLETIN: "bg-primary/12 text-primary",
  IMPACT: "bg-secondary/20 text-secondary-foreground",
  EMBAUCHE: "bg-accent/20 text-accent-foreground",
};

// ===========================================================================
// Tri auto-suffisant (voir en-tête de fichier)
// ===========================================================================
type SensTriInline = "asc" | "desc";
type TriInline = { cle: string; sens: SensTriInline } | null;

function trierScenarios(lignes: ScenarioSimulation[], tri: TriInline): ScenarioSimulation[] {
  if (!tri) return lignes;
  const { cle, sens } = tri;
  return [...lignes].sort((a, b) => {
    const va = (a as unknown as Record<string, unknown>)[cle];
    const vb = (b as unknown as Record<string, unknown>)[cle];
    const cmp = String(va ?? "").localeCompare(String(vb ?? ""));
    return sens === "asc" ? cmp : -cmp;
  });
}

function EnTeteTriableInline({ label, cle, tri, onTrier }: { label: string; cle: string; tri: TriInline; onTrier: (cle: string) => void }) {
  const actif = tri?.cle === cle;
  return (
    <TableHead>
      <button
        onClick={() => onTrier(cle)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${actif ? "text-primary font-medium" : "text-muted-foreground"}`}
      >
        {label}
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${actif ? "opacity-100" : "opacity-30"} ${actif && tri!.sens === "asc" ? "rotate-180" : ""}`} />
      </button>
    </TableHead>
  );
}

function useTriInline<T>(lignes: T[], trierFn: (l: T[], t: TriInline) => T[]) {
  const [tri, setTri] = useState<TriInline>({ cle: "updated_at", sens: "desc" });
  function basculerTri(cle: string) {
    setTri((t) => (t?.cle === cle ? (t.sens === "asc" ? { cle, sens: "desc" } : null) : { cle, sens: "asc" }));
  }
  return { donneesTriees: trierFn(lignes, tri), tri, basculerTri };
}

export default function MesScenariosPage() {
  const [scenarios, setScenarios] = useState<ScenarioSimulation[]>([]);
  const [chargement, setChargement] = useState(true);
  const [filtreType, setFiltreType] = useState<ModeSimulation | "TOUS">("TOUS");
  const [filtreTexte, setFiltreTexte] = useState("");
  const [creationOuverte, setCreationOuverte] = useState(false);
  const [scenarioEnEditionId, setScenarioEnEditionId] = useState<string | null>(null);
  const [populationsById, setPopulationsById] = useState<Record<string, string>>({});

  useEffect(() => {
    listerPopulationsCompletes()
      .then((pops) => setPopulationsById(Object.fromEntries(pops.map((p) => [p.id, p.libelle]))))
      .catch(() => setPopulationsById({}));
  }, []);

  async function charger() {
    setChargement(true);
    try {
      const data = await listerScenarios({
        type_simulation: filtreType === "TOUS" ? undefined : filtreType,
        inclure_partages: true,
      });
      setScenarios(data);
    } finally {
      setChargement(false);
    }
  }

  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtreType]);

  const scenariosFiltres = scenarios.filter((s) =>
    filtreTexte.trim() ? s.nom.toLowerCase().includes(filtreTexte.trim().toLowerCase()) : true
  );

  const { donneesTriees, tri, basculerTri } = useTriInline(scenariosFiltres, trierScenarios);

  async function surDupliquer(id: string) {
    await dupliquerScenario(id);
    charger();
  }

  async function surArchiver(id: string) {
    if (!window.confirm("Archiver ce scénario ? Il ne sera plus visible dans la liste.")) return;
    await archiverScenario(id);
    charger();
  }

  async function surBasculerPartage(scenario: ScenarioSimulation) {
    await modifierScenario(scenario.id, { partage: !scenario.partage });
    charger();
  }

  async function surExporterExcel(scenario: ScenarioSimulation) {
    if (!scenario.resultat_calcule) {
      window.alert("Ce scénario n'a pas de résultat calculé à exporter — ouvre-le et relance le calcul d'abord.");
      return;
    }
    await exporterExcelSimulation({
      titre: scenario.nom,
      type_simulation: scenario.type_simulation,
      resultat: scenario.resultat_calcule,
    });
  }

  function ouvrir(id: string) {
    setCreationOuverte(false);
    setScenarioEnEditionId(id);
  }

  const nbPartages = scenarios.filter((s) => s.partage).length;
  const parType: Record<ModeSimulation, number> = { BULLETIN: 0, IMPACT: 0, EMBAUCHE: 0 };
  scenarios.forEach((s) => { parType[s.type_simulation] += 1; });

  return (
    <div className="p-6 space-y-6 w-full">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <FlaskConical className="h-6 w-6 text-primary" /> Mes scénarios
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Scénarios personnels et partagés par d'autres — réutilisables individuellement ou appliqués en masse
            sur une population depuis l'écran de lancement.
          </p>
        </div>
        <Button onClick={() => { setCreationOuverte((o) => !o); setScenarioEnEditionId(null); }}>
          {creationOuverte ? <X className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
          {creationOuverte ? "Annuler" : "Nouveau scénario"}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md border bg-card p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><ListChecks className="h-3.5 w-3.5" /> Total</div>
          <div className="text-xl font-semibold tabular-nums mt-0.5">{scenarios.length}</div>
        </div>
        <div className="rounded-md border bg-card p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Users2 className="h-3.5 w-3.5 text-secondary" /> Partagés</div>
          <div className="text-xl font-semibold tabular-nums mt-0.5">{nbPartages}</div>
        </div>
        <div className="rounded-md border bg-card p-3">
          <div className="text-xs text-muted-foreground">Bulletin</div>
          <div className="text-xl font-semibold tabular-nums mt-0.5">{parType.BULLETIN}</div>
        </div>
        <div className="rounded-md border bg-card p-3">
          <div className="text-xs text-muted-foreground">Impact · Embauche</div>
          <div className="text-xl font-semibold tabular-nums mt-0.5">{parType.IMPACT + parType.EMBAUCHE}</div>
        </div>
      </div>

      {(creationOuverte || scenarioEnEditionId) && (
        <NouveauScenarioPanel
          scenarioId={scenarioEnEditionId}
          onAnnule={() => { setCreationOuverte(false); setScenarioEnEditionId(null); }}
          onCree={() => { setCreationOuverte(false); setScenarioEnEditionId(null); charger(); }}
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Rechercher un scénario…"
          value={filtreTexte}
          onChange={(e) => setFiltreTexte(e.target.value)}
          className="w-64"
        />
        <div className="inline-flex rounded-md border bg-card p-0.5 text-sm">
          {(["TOUS", "BULLETIN", "IMPACT", "EMBAUCHE"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFiltreType(t)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-colors ${
                filtreType === t ? "bg-primary text-primary-foreground font-medium shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
            >
              {t === "TOUS" ? "Tous" : LIBELLES_TYPE[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-md border">
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <EnTeteTriableInline label="Nom" cle="nom" tri={tri} onTrier={basculerTri} />
              <EnTeteTriableInline label="Type" cle="type_simulation" tri={tri} onTrier={basculerTri} />
              <EnTeteTriableInline label="Modifié le" cle="updated_at" tri={tri} onTrier={basculerTri} />
              <EnTeteTriableInline label="Partagé" cle="partage" tri={tri} onTrier={basculerTri} />
              <TableCell className="text-right text-xs font-medium uppercase text-muted-foreground">Actions</TableCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {chargement && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            )}
            {!chargement && donneesTriees.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center">
                  <FlaskConical className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
                  <p className="text-sm text-muted-foreground">Aucun scénario pour l'instant.</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => setCreationOuverte(true)}>
                    <Plus className="mr-2 h-3.5 w-3.5" /> Créer le premier
                  </Button>
                </TableCell>
              </TableRow>
            )}
            {!chargement &&
              donneesTriees.map((s) => (
                <TableRow key={s.id} className="hover:bg-muted/30">
                  <TableCell className="font-medium">
                    {s.nom}
                    {s.population_id && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <Users2 className="h-3 w-3 text-secondary" />
                        <span className="text-xs text-muted-foreground">
                          Restreint à « {populationsById[s.population_id] ?? "population inconnue"} »
                        </span>
                      </div>
                    )}
                    {s.date_application && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <Calendar className="h-3 w-3 text-accent-foreground" />
                        <span className="text-xs text-muted-foreground">
                          À partir du {new Date(s.date_application).toLocaleDateString("fr-MA")}
                        </span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CLASSES_TYPE[s.type_simulation]}`}>
                      {LIBELLES_TYPE[s.type_simulation]}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {new Date(s.updated_at).toLocaleString("fr-MA", { dateStyle: "short", timeStyle: "short" })}
                  </TableCell>
                  <TableCell>
                    {s.partage ? <span className="text-primary">Oui</span> : <span className="text-muted-foreground">Non</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <IconBtn titre="Ouvrir" onClick={() => ouvrir(s.id)}>
                        <FolderOpen className="h-4 w-4" />
                      </IconBtn>
                      <IconBtn titre="Dupliquer" onClick={() => surDupliquer(s.id)}>
                        <Copy className="h-4 w-4" />
                      </IconBtn>
                      <IconBtn titre={s.partage ? "Rendre personnel" : "Partager"} onClick={() => surBasculerPartage(s)}>
                        <Share2 className={`h-4 w-4 ${s.partage ? "text-primary" : ""}`} />
                      </IconBtn>
                      <IconBtn titre="Exporter Excel" onClick={() => surExporterExcel(s)}>
                        <FileDown className="h-4 w-4" />
                      </IconBtn>
                      <IconBtn titre="Archiver" onClick={() => surArchiver(s.id)}>
                        <Archive className="h-4 w-4 text-destructive" />
                      </IconBtn>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function IconBtn({
  titre,
  onClick,
  children,
  desactive = false,
}: {
  titre: string;
  onClick: () => void;
  children: React.ReactNode;
  desactive?: boolean;
}) {
  return (
    <Button variant="ghost" size="icon" className="h-8 w-8" title={titre} onClick={onClick} disabled={desactive}>
      {children}
    </Button>
  );
}

// ===========================================================================
// Nouveau scénario — orienté POPULATION (RG-SIM-SCENARIO-01/05)
//
// Un scénario est fondamentalement des SURCHARGES (rubrique/table/régime) —
// indépendant de tout collaborateur précis (collaborateur_id: null, comme
// le fait déjà le mode Embauche — RG-SIM-IND-06). La population choisie ici
// sert à la fois à PRÉVISUALISER (aperçu de l'effectif, résolution du mode
// Pourcentage) ET, si elle est renseignée, à RESTREINDRE réellement le
// scénario (RG-SIM-SCENARIO-05 — confirmé par Adil DAIA) : au lancement en
// masse, un scénario avec population_id ne s'applique QU'aux collaborateurs
// de cette population précise, même si le lancement cible une population
// différente ou "toutes les populations". Laisser la population vide garde
// le comportement libre (applicable à n'importe quelle population).
// ===========================================================================
type Plan = { id: string; code: string; libelle: string };
type PeriodeOption = { id: string; annee: number; mois: number };
const MOIS_COURT = ["", "Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];

type LigneSurchargeUI =
  | ({ nature: "rubrique"; id: string } & Omit<SurchargeRubrique, "mode"> & { mode: "AJOUT" | "FORCAGE" | "POURCENTAGE" })
  | ({ nature: "table"; id: string } & SurchargeTable)
  | ({ nature: "regime"; id: string } & SurchargeRegime);

function NouveauScenarioPanel({ scenarioId, onAnnule, onCree }: { scenarioId?: string | null; onAnnule: () => void; onCree: () => void }) {
  const modeEdition = !!scenarioId;
  const [nom, setNom] = useState("");
  const [populations, setPopulations] = useState<PopulationPaieRead[]>([]);
  const [populationId, setPopulationId] = useState("");
  const [dateApplication, setDateApplication] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState("");
  const [periodes, setPeriodes] = useState<PeriodeOption[]>([]);
  const [periodeId, setPeriodeId] = useState("");
  const [lignes, setLignes] = useState<LigneSurchargeUI[]>([]);
  const [apercuCount, setApercuCount] = useState<number | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const [chargementScenario, setChargementScenario] = useState(modeEdition);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    listerPopulationsCompletes().then(setPopulations).catch(() => setPopulations([]));
    db.list<Plan>("plan_paie", { select: "id,code,libelle", order: "libelle" }).then(setPlans).catch(() => setPlans([]));
  }, []);

  // Mode édition (RG-SIM-SCENARIO-04) : charge le scénario existant et
  // reconstruit les lignes de l'éditeur à partir de ses hypotheses déjà
  // enregistrées — un `id` local (requis par EditeurSurcharges pour le
  // suivi React) est régénéré à chaque ligne, jamais persisté tel quel.
  useEffect(() => {
    if (!scenarioId) return;
    setChargementScenario(true);
    lireScenario(scenarioId)
      .then((s) => {
        setNom(s.nom);
        setPopulationId(s.population_id ?? "");
        setDateApplication(s.date_application ?? "");
        const hyp = s.hypotheses as {
          surcharges_rubrique?: SurchargeRubrique[]; surcharges_table?: SurchargeTable[]; surcharges_regime?: SurchargeRegime[];
        };
        let compteur = 0;
        const idLocal = () => `edit-${Date.now()}-${compteur++}`;
        const reconstruites: LigneSurchargeUI[] = [
          ...(hyp.surcharges_rubrique ?? []).map((s2) => ({ nature: "rubrique" as const, id: idLocal(), ...s2 })),
          ...(hyp.surcharges_table ?? []).map((s2) => ({ nature: "table" as const, id: idLocal(), ...s2 })),
          ...(hyp.surcharges_regime ?? []).map((s2) => ({ nature: "regime" as const, id: idLocal(), ...s2 })),
        ];
        setLignes(reconstruites);
      })
      .catch((e) => setErreur(e instanceof Error ? e.message : "Erreur de chargement du scénario"))
      .finally(() => setChargementScenario(false));
  }, [scenarioId]);

  useEffect(() => {
    if (!planId) { setPeriodes([]); setPeriodeId(""); return; }
    db.list<PeriodeOption>("calendrier_paie", {
      plan_paie_id: planId, statut: "OUVERTE", select: "id,annee,mois", order: "annee.desc",
    })
      .then((rows) => setPeriodes([...rows].sort((a, b) => b.annee - a.annee || b.mois - a.mois)))
      .catch(() => setPeriodes([]));
  }, [planId]);

  async function tester() {
    if (!populationId) {
      setErreur("Choisis une population pour tester l'aperçu.");
      return;
    }
    setErreur(null);
    try {
      const cibles = await apercuPopulation({ population_id: populationId });
      setApercuCount(cibles.length);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur d'aperçu");
    }
  }

  const contientPourcentage = lignes.some((l) => l.nature === "rubrique" && l.mode === "POURCENTAGE");

  async function enregistrer() {
    if (!nom.trim()) {
      setErreur("Le nom du scénario est requis.");
      return;
    }
    if (lignes.length === 0) {
      setErreur("Ajoute au moins une surcharge.");
      return;
    }
    setEnregistrement(true);
    setErreur(null);
    try {
      // RG-SIM-SCENARIO-02 : le mode "Pourcentage" n'est PLUS résolu ici —
      // il est envoyé tel quel (mode="POURCENTAGE", valeur=le %), et résolu
      // par le backend SÉPARÉMENT POUR CHAQUE COLLABORATEUR au moment du
      // lancement en masse (_resoudre_pourcentages_rubrique côté serveur),
      // contre le montant RÉEL de chacun — plus une approximation figée
      // contre un seul collaborateur de référence.
      const surcharges_rubrique = lignes
        .filter((l): l is Extract<LigneSurchargeUI, { nature: "rubrique" }> => l.nature === "rubrique")
        .map(({ id, nature, ...s }) => s);
      const surcharges_table = lignes
        .filter((l): l is Extract<LigneSurchargeUI, { nature: "table" }> => l.nature === "table")
        .map(({ id, nature, ...s }) => s);
      const surcharges_regime = lignes
        .filter((l): l is Extract<LigneSurchargeUI, { nature: "regime" }> => l.nature === "regime")
        .map(({ id, nature, ...s }) => s);

      const hypotheses = { surcharges_rubrique, surcharges_table, surcharges_regime };
      if (modeEdition && scenarioId) {
        await modifierScenario(scenarioId, { nom: nom.trim(), hypotheses, population_id: populationId || null, date_application: dateApplication || null });
      } else {
        await creerScenario({
          type_simulation: "BULLETIN",
          nom: nom.trim(),
          collaborateur_id: null, // orienté population — voir commentaire d'en-tête
          population_id: populationId || null, // RG-SIM-SCENARIO-05 : restreint réellement le scénario si renseigné
          date_application: dateApplication || null, // RG-SIM-SCENARIO-06 : sinon dès la première période simulée
          hypotheses,
          partage: false,
        });
      }
      onCree();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur d'enregistrement");
    } finally {
      setEnregistrement(false);
    }
  }

  return (
    <div className="rounded-md border-2 border-primary/30 bg-muted/20 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Plus className="h-4 w-4 text-primary" /> {modeEdition ? "Modifier le scénario" : "Nouveau scénario"}
        </h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onAnnule}><X className="h-4 w-4" /></Button>
      </div>

      {chargementScenario ? (
        <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
      <>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Nom du scénario</label>
        <Input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Ex. Revalorisation prime transport +10%" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Population — <span className="font-normal">optionnelle. Si choisie, ce scénario ne s'appliquera QU'à cette population au lancement. Laisse vide pour qu'il reste utilisable sur n'importe quelle population.</span>
          </label>
          <select
            className="flex h-9 w-full items-center rounded-md border bg-background px-3 text-sm"
            value={populationId}
            onChange={(e) => { setPopulationId(e.target.value); setApercuCount(null); }}
          >
            <option value="">— Choisir —</option>
            {populations.map((p) => (
              <option key={p.id} value={p.id}>{p.libelle}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Date d'application — <span className="font-normal">optionnelle. Si vide, s'applique dès la première période simulée. Sinon, à partir de la première période contenant cette date.</span>
          </label>
          <Input type="date" value={dateApplication} onChange={(e) => setDateApplication(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Plan de paie</label>
          <select
            className="flex h-9 w-full items-center rounded-md border bg-background px-3 text-sm"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
          >
            <option value="">— Choisir —</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>{p.code} · {p.libelle}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Période (pour l'aperçu)</label>
          <select
            className="flex h-9 w-full items-center rounded-md border bg-background px-3 text-sm disabled:opacity-50"
            value={periodeId}
            onChange={(e) => setPeriodeId(e.target.value)}
            disabled={!planId}
          >
            <option value="">— Choisir —</option>
            {periodes.map((p) => (
              <option key={p.id} value={p.id}>{MOIS_COURT[p.mois]} {p.annee}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={tester}>Tester (aperçu)</Button>
        {apercuCount !== null && (
          <span className="text-sm text-muted-foreground">{apercuCount} collaborateur(s) correspondant(s)</span>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Surcharges</label>
        <EditeurSurcharges lignes={lignes} onChange={setLignes} />
        {contientPourcentage && (
          <p className="text-xs text-muted-foreground">
            Une ligne en mode « Pourcentage » sera calculée séparément pour CHAQUE collaborateur au moment du
            lancement, contre son propre montant réel — pas une valeur figée à l'enregistrement.
          </p>
        )}
      </div>

      {erreur && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {erreur}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onAnnule}>Annuler</Button>
        <Button size="sm" onClick={enregistrer} disabled={enregistrement}>
          {enregistrement && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          {modeEdition ? "Enregistrer les modifications" : "Enregistrer le scénario"}
        </Button>
      </div>
      </>
      )}
    </div>
  );
}
