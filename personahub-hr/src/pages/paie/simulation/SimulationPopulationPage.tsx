/**
 * src/pages/paie/simulation/SimulationPopulationPage.tsx
 * Route : /paie/traitement/simulation-population
 *
 * Écran SÉPARÉ de SimulationIndividuellePage.tsx (RG-SIM-POPULATION-01) —
 * lancement en masse d'une simulation sur une population (ou l'ensemble des
 * populations actives), en appliquant un ou plusieurs scénarios déjà
 * sauvegardés, sur une PLAGE de périodes (début → fin, impact cumulé).
 *
 * Produit destiné à des clients pouvant dépasser 300 collaborateurs : le
 * lancement est ASYNCHRONE (job en tâche de fond côté serveur) — cet écran
 * crée le job, reçoit un job_id immédiatement, puis interroge son statut en
 * polling jusqu'à TERMINE/ERREUR, avec une barre de progression.
 *
 * Double vue TOUJOURS affichée ensemble (jamais un choix exclusif) :
 *   • Fusion       : tous les scénarios sélectionnés combinés en un seul calcul.
 *   • Par scénario : chaque scénario appliqué séparément, comparé côte à côte.
 *
 * Gestion de population intégrée (créer/modifier) : les 18 critères liés à
 * une table de référence sont des menus déroulants multi-sélection avec
 * recherche par saisie, résolus via l'introspection de clé étrangère déjà
 * existante (GET /simulation/referentiel-valeurs, RubriqueSimulable) —
 * appliquée à la vraie colonne source de chaque critère (ex. unite_ids
 * filtre sur collaborateur_affectations.unite_id, dont la FK réelle pointe
 * vers unites_organisationnelles), pas devinée. Un critère dont la colonne
 * source n'a pas de FK réelle retombe automatiquement sur une saisie libre
 * (comportement déjà géré par cet endpoint, RG-SIM-RUBRIQUE-01).
 */
import { Fragment, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, ChevronDown, Clock, FileDown, Gauge, Loader2, Pencil, Plus, Search, Sparkles, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableHeader, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PaveAccordeon } from "@/components/paie/simulation/PaveAccordeon";
import { db } from "@/lib/api";
import {
  listerScenarios,
  lancerSimulationPopulation,
  lireJobPopulation,
  exporterExcelSimulation,
  genererAnneeCalendrier,
  valeursReferentielChamp,
  listerBulletinsPopulation,
  lireBulletinPopulation,
  type ScenarioSimulation,
  type SimulationPopulationResult,
  type SimulationPopulationJobStatut,
  type ValeurReferentielle,
  type ModeRegroupementBulletins,
  type GroupeBulletinsPopulation,
  type BulletinSimulePopulation,
  type BulletinSimuleDetail,
  type LigneBulletin,
} from "@/lib/simulation-api";
import {
  listerPopulationsCompletes,
  creerPopulation,
  modifierPopulation,
  apercuPopulation,
  criteresVides,
  type PopulationPaieRead,
  type PopulationPaieWrite,
  type ModePopulation,
  type CollaborateurCible,
} from "@/lib/population-api";

type Plan = { id: string; code: string; libelle: string };
type PeriodeOption = { id: string; annee: number; mois: number };
const MOIS_COURT = ["", "Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
const INTERVALLE_POLLING_MS = 2000;

/**
 * Préférences utilisateur persistantes (localStorage — écran réel de
 * l'application, PAS un artefact Claude, donc localStorage est ici
 * approprié) : dernière population/plan/mode de regroupement utilisés,
 * restaurés à l'ouverture. Défensif (try/catch) — un navigateur en mode
 * privé strict ou localStorage désactivé ne doit jamais faire planter
 * l'écran, juste repartir sans préférence mémorisée.
 */
const CLE_PREFS_SIMULATION_POPULATION = "personahub:simulation-population:prefs";
type PrefsSimulationPopulation = {
  populationId?: string;
  planId?: string;
  modeRegroupement?: ModeRegroupementBulletins;
};
function chargerPrefsSimulationPopulation(): PrefsSimulationPopulation {
  try {
    return JSON.parse(localStorage.getItem(CLE_PREFS_SIMULATION_POPULATION) || "{}");
  } catch {
    return {};
  }
}
function sauverPrefsSimulationPopulation(patch: Partial<PrefsSimulationPopulation>) {
  try {
    localStorage.setItem(CLE_PREFS_SIMULATION_POPULATION, JSON.stringify({ ...chargerPrefsSimulationPopulation(), ...patch }));
  } catch {
    // silencieux — une préférence non sauvegardée n'est jamais bloquante
  }
}

export default function SimulationPopulationPage() {
  const navigate = useNavigate();
  const prefsInitiales = chargerPrefsSimulationPopulation();
  const [populations, setPopulations] = useState<PopulationPaieRead[]>([]);
  const [populationId, setPopulationId] = useState<string>(prefsInitiales.populationId ?? ""); // "" = toutes les populations
  const [editeurPopulationOuvert, setEditeurPopulationOuvert] = useState<"nouveau" | "modifier" | null>(null);

  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState(prefsInitiales.planId ?? "");
  const [periodes, setPeriodes] = useState<PeriodeOption[]>([]);
  const [periodeDebutId, setPeriodeDebutId] = useState("");
  const [periodeFinId, setPeriodeFinId] = useState("");
  const [anneeAGenerer, setAnneeAGenerer] = useState<number>(new Date().getFullYear() + 1);
  const [generationEnCours, setGenerationEnCours] = useState(false);

  const [scenarios, setScenarios] = useState<ScenarioSimulation[]>([]);
  const [scenarioIds, setScenarioIds] = useState<string[]>([]);
  const [avecEcarts, setAvecEcarts] = useState(true);

  const [job, setJob] = useState<SimulationPopulationJobStatut | null>(null);
  const [enLancement, setEnLancement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [popupKpiOuverte, setPopupKpiOuverte] = useState(false);

  function choisirPopulation(id: string) {
    setPopulationId(id);
    sauverPrefsSimulationPopulation({ populationId: id });
  }
  function choisirPlan(id: string) {
    setPlanId(id);
    sauverPrefsSimulationPopulation({ planId: id });
  }

  function chargerPopulations() {
    listerPopulationsCompletes().then(setPopulations).catch(() => setPopulations([]));
  }
  function chargerScenarios() {
    listerScenarios().then(setScenarios).catch(() => setScenarios([]));
  }
  function chargerPeriodes() {
    if (!planId) { setPeriodes([]); return; }
    db.list<PeriodeOption>("calendrier_paie", {
      plan_paie_id: planId, statut: "OUVERTE", select: "id,annee,mois", order: "annee.asc",
    })
      .then((rows) => setPeriodes([...rows].sort((a, b) => a.annee - b.annee || a.mois - b.mois)))
      .catch(() => setPeriodes([]));
  }

  useEffect(() => {
    chargerPopulations();
    chargerScenarios();
    db.list<Plan>("plan_paie", { select: "id,code,libelle", order: "libelle" }).then(setPlans).catch(() => setPlans([]));
  }, []);

  useEffect(() => {
    chargerPeriodes();
    setPeriodeDebutId(""); setPeriodeFinId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  useEffect(() => {
    if (periodes.length) setAnneeAGenerer(Math.max(...periodes.map((p) => p.annee)) + 1);
  }, [periodes]);

  // Polling du job tant qu'il n'est pas terminé.
  useEffect(() => {
    if (!job || job.statut === "TERMINE" || job.statut === "ERREUR") return;
    const id = setInterval(async () => {
      try {
        setJob(await lireJobPopulation(job.id));
      } catch (e) {
        setErreur(e instanceof Error ? e.message : "Erreur de suivi du lancement");
        clearInterval(id);
      }
    }, INTERVALLE_POLLING_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.statut]);

  // Ouvre automatiquement la popup de KPI dès que le job PASSE à TERMINE
  // (une seule fois, au moment précis de la transition — pas à chaque
  // re-rendu tant que le statut reste TERMINE).
  useEffect(() => {
    if (job?.statut === "TERMINE" && job.resultat) setPopupKpiOuverte(true);
  }, [job?.statut]);

  function basculerScenario(id: string) {
    setScenarioIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function genererExercice() {
    if (!planId) return;
    setGenerationEnCours(true);
    setErreur(null);
    try {
      const res = await genererAnneeCalendrier(planId, anneeAGenerer);
      chargerPeriodes();
      alert(
        res.annee_source
          ? `${res.nb_periodes_creees} période(s) générée(s) pour ${anneeAGenerer}, sur le modèle de l'exercice ${res.annee_source}.`
          : `${res.nb_periodes_creees} période(s) générée(s) pour ${anneeAGenerer} — aucun exercice existant sur ce plan, schéma mensuel par défaut appliqué (à vérifier).`
      );
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur de génération de l'exercice");
    } finally {
      setGenerationEnCours(false);
    }
  }

  async function lancer() {
    if (!periodeDebutId || !periodeFinId) {
      setErreur("Une période de début et une période de fin sont requises.");
      return;
    }
    setEnLancement(true);
    setErreur(null);
    setJob(null);
    setPopupKpiOuverte(false);
    try {
      const cree = await lancerSimulationPopulation({
        population_id: populationId || null,
        periode_debut_id: periodeDebutId,
        periode_fin_id: periodeFinId,
        scenario_ids: scenarioIds,
        avec_ecarts: avecEcarts,
      });
      setJob({
        id: cree.job_id, statut: "EN_ATTENTE", population_nom: "", nb_total: cree.nb_total, nb_traites: 0,
        erreur: null, resultat: null, created_at: new Date().toISOString(), termine_at: null,
      });
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur de lancement");
    } finally {
      setEnLancement(false);
    }
  }

  async function exporterExcel() {
    if (!job?.resultat) return;
    await exporterExcelSimulation({
      titre: `Simulation_Population_${job.resultat.population_nom.replace(/\s+/g, "_")}`,
      type_simulation: "POPULATION" as any,
      resultat: job.resultat as unknown as Record<string, unknown>,
    });
  }

  const populationEnEdition = editeurPopulationOuvert === "modifier" ? populations.find((p) => p.id === populationId) ?? null : null;

  return (
    <div className="p-6 space-y-6 w-full">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Users className="h-6 w-6" /> Simulation par population
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Lancement en masse — un ou plusieurs scénarios appliqués à toute une population, sur une plage de
          périodes. Calcul à la volée, jamais persisté dans un bulletin réel.
        </p>
      </div>

      <PaveAccordeon
        sections={[
          {
            valeur: "cible",
            titre: "Cible et période",
            contenu: (
              <div className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Population</label>
                    <div className="flex gap-2">
                      <Select value={populationId || "__toutes__"} onValueChange={(v) => choisirPopulation(v === "__toutes__" ? "" : v)}>
                        <SelectTrigger className="h-10 flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__toutes__">— Toutes les populations —</SelectItem>
                          {populations.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.libelle}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button variant="outline" size="icon" title="Nouvelle population" onClick={() => setEditeurPopulationOuvert("nouveau")}>
                        <Plus className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline" size="icon" title="Modifier la population sélectionnée"
                        disabled={!populationId}
                        onClick={() => setEditeurPopulationOuvert("modifier")}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Plan de paie</label>
                    <Select value={planId || undefined} onValueChange={choisirPlan}>
                      <SelectTrigger className="h-10 w-full">
                        <SelectValue placeholder="Sélectionner…" />
                      </SelectTrigger>
                      <SelectContent>
                        {plans.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.code} · {p.libelle}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {editeurPopulationOuvert && (
                  <EditeurPopulation
                    population={populationEnEdition}
                    onFerme={() => setEditeurPopulationOuvert(null)}
                    onEnregistre={(id) => { chargerPopulations(); choisirPopulation(id); setEditeurPopulationOuvert(null); }}
                  />
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Période — début</label>
                    <Select value={periodeDebutId || undefined} onValueChange={setPeriodeDebutId} disabled={!planId}>
                      <SelectTrigger className="h-10 w-full">
                        <SelectValue placeholder="Sélectionner…" />
                      </SelectTrigger>
                      <SelectContent>
                        {periodes.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{MOIS_COURT[p.mois]} {p.annee}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Période — fin</label>
                    <Select value={periodeFinId || undefined} onValueChange={setPeriodeFinId} disabled={!planId}>
                      <SelectTrigger className="h-10 w-full">
                        <SelectValue placeholder="Sélectionner…" />
                      </SelectTrigger>
                      <SelectContent>
                        {periodes.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{MOIS_COURT[p.mois]} {p.annee}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {planId && (
                  <div className="rounded-md border bg-muted/30 p-3 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      La période de fin souhaitée n'existe pas encore ? Générer les 12 périodes d'un exercice pour ce plan :
                    </span>
                    <input
                      type="number"
                      className="h-8 w-24 rounded-md border bg-background px-2 text-sm"
                      value={anneeAGenerer}
                      onChange={(e) => setAnneeAGenerer(Number(e.target.value))}
                    />
                    <Button size="sm" variant="outline" onClick={genererExercice} disabled={generationEnCours}>
                      {generationEnCours && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                      Générer l'exercice {anneeAGenerer}
                    </Button>
                  </div>
                )}
              </div>
            ),
          },
          {
            valeur: "scenarios",
            titre: "Scénarios à appliquer",
            badge: scenarioIds.length > 0 ? <Badge>{scenarioIds.length}</Badge> : undefined,
            contenu: (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Deux vues sont toujours calculées ensemble : tous les scénarios cochés fusionnés en un seul
                  calcul, ET chaque scénario appliqué séparément pour comparer leur impact individuel — cumulés
                  sur toute la plage de périodes. <strong>Aucun scénario coché</strong> = calcul « tel quel » pur
                  (aucune hypothèse de changement), avec projection retraite/fin de contrat prévisionnelle sur les
                  périodes futures.
                </p>
                {scenarios.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">Aucun scénario sauvegardé pour l'instant.</p>
                ) : (
                  <div className="rounded-md border divide-y overflow-hidden">
                    {scenarios.map((s) => {
                      const coche = scenarioIds.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          onClick={() => basculerScenario(s.id)}
                          className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors border-l-2 ${
                            coche ? "bg-primary/8 border-l-primary" : "border-l-transparent hover:bg-muted/50"
                          }`}
                        >
                          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${coche ? "bg-primary border-primary" : "border-muted-foreground/40"}`}>
                            {coche && <Check className="h-2.5 w-2.5 text-primary-foreground" strokeWidth={3} />}
                          </span>
                          <span className={`flex-1 ${coche ? "font-medium text-primary" : ""}`}>{s.nom}</span>
                          <span className={`text-xs rounded-full px-2 py-0.5 ${coche ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}>{s.type_simulation}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <label className="flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm cursor-pointer hover:bg-muted/30">
                  <Checkbox
                    checked={avecEcarts}
                    onCheckedChange={(v) => setAvecEcarts(v === true)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">Calculer les écarts</span>
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      Décocher masque les écarts (avant/après) partout — dans le résumé, la consultation et l'export.
                      Accélère aussi le calcul en général, sauf si un scénario a une surcharge en %, auquel cas le
                      calcul « tel quel » reste nécessaire en interne pour ce scénario précis (les écarts restent
                      malgré tout masqués si la case est décochée).
                    </span>
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <Button onClick={lancer} disabled={enLancement || (!!job && job.statut !== "TERMINE" && job.statut !== "ERREUR")}>
                    {enLancement && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Lancer la simulation
                  </Button>
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => {
                      const enCours = job && job.statut !== "TERMINE" && job.statut !== "ERREUR";
                      if (enCours && !window.confirm("Un lancement est en cours — le quitter maintenant l'interrompra du point de vue de cet écran (il continue en tâche de fond côté serveur). Continuer ?")) {
                        return;
                      }
                      navigate("/paie/traitement/simulation/scenarios");
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" /> Créer un scénario
                  </Button>
                  {scenarios.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={chargerScenarios}>Rafraîchir la liste</Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  « Créer un scénario » ouvre l'écran de gestion des scénarios dans cet onglet (pas un nouvel
                  onglet — le jeton de connexion est isolé par onglet, un nouvel onglet demanderait de te
                  reconnecter). Population, plan et mode de regroupement sont mémorisés et retrouvés à ton retour.
                </p>
              </div>
            ),
          },
          {
            valeur: "resultat",
            titre: "Résultat",
            contenu: <SuiviJobEtResultat job={job} onExporter={exporterExcel} />,
          },
        ]}
        ouvertsParDefaut={["cible", "scenarios", "resultat"]}
      />
      {erreur && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erreur}
        </div>
      )}
      {popupKpiOuverte && job?.resultat && (
        <PopupKpiTermine resultat={job.resultat} onFermer={() => setPopupKpiOuverte(false)} />
      )}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
      {children}
    </span>
  );
}

/**
 * Popup automatique dès que le job passe à TERMINE — résumé KPI, pour que
 * l'utilisateur voie tout de suite le résultat sans avoir à rouvrir
 * l'accordéon "Résultat" manuellement.
 */
function PopupKpiTermine({ resultat, onFermer }: { resultat: SimulationPopulationResult; onFermer: () => void }) {
  const fmt = (v: string | null) => (v == null ? "—" : parseFloat(v).toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const ecartCouleur = (v: string | null) => {
    if (v == null) return undefined;
    const n = parseFloat(v);
    return n === 0 ? undefined : n > 0 ? "hsl(var(--success, 142 71% 35%))" : "hsl(var(--destructive))";
  };
  const plage = resultat.periode_debut_libelle === resultat.periode_fin_libelle
    ? resultat.periode_debut_libelle
    : `${resultat.periode_debut_libelle} → ${resultat.periode_fin_libelle}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onFermer}>
      <div className="w-full max-w-lg rounded-lg border bg-background shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2 font-medium">
            <Check className="h-4 w-4" style={{ color: "hsl(var(--success, 142 71% 35%))" }} />
            Simulation terminée
          </div>
          <Button variant="ghost" size="icon" onClick={onFermer}><X className="h-4 w-4" /></Button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <div className="font-medium">{resultat.population_nom}</div>
            <div className="text-xs text-muted-foreground">
              {plage} ({resultat.nb_periodes} période{resultat.nb_periodes > 1 ? "s" : ""})
              {resultat.scenarios.length > 0 && ` · ${resultat.scenarios.map((s) => s.nom).join(", ")}`}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Collaborateurs</div>
              <div className="text-xl font-semibold tabular-nums">{resultat.nb_collaborateurs}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Erreurs</div>
              <div className="text-xl font-semibold tabular-nums" style={{ color: resultat.nb_erreurs > 0 ? "hsl(var(--destructive))" : undefined }}>
                {resultat.nb_erreurs}
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Net à payer — après</div>
              <div className="text-xl font-semibold tabular-nums">{fmt(resultat.resume_fusion.net_apres)}</div>
              {resultat.avec_ecarts && (
                <div className="text-xs tabular-nums" style={{ color: ecartCouleur(resultat.resume_fusion.ecart_net) }}>
                  écart {fmt(resultat.resume_fusion.ecart_net)}
                </div>
              )}
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Coût employeur — masse salariale</div>
              <div className="text-xl font-semibold tabular-nums">{fmt(resultat.resume_fusion.cout_employeur_apres)}</div>
              {resultat.avec_ecarts && (
                <div className="text-xs tabular-nums" style={{ color: ecartCouleur(resultat.resume_fusion.ecart_cout_employeur) }}>
                  écart {fmt(resultat.resume_fusion.ecart_cout_employeur)}
                </div>
              )}
            </div>
          </div>

          <Button className="w-full" onClick={onFermer}>Voir le détail</Button>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Éditeur de population (créer / modifier) — formulaire simple, sans
// référentiels dédiés (voir note en tête de fichier).
// ===========================================================================
/**
 * Association critère → colonne SOURCE réelle (confirmée en lisant
 * app/services/population_paie.py, _construire_conditions_criteres — pas
 * devinée) : chaque critère de population_paie filtre en réalité sur une
 * colonne d'une autre table (collaborateur_affectations, collaborateur_
 * contrats, collaborateur_regime, collaborateur_qualifications...). C'est
 * la FK RÉELLE de cette colonne source (introspectée à la volée par
 * GET /simulation/referentiel-valeurs) qui détermine si un menu déroulant
 * est possible — jamais un nom de table de référence deviné à l'avance.
 */
const GROUPES_CRITERES: {
  titre: string;
  champs: { cle: keyof ReturnType<typeof criteresVides>; label: string; table: string; colonne: string }[];
}[] = [
  {
    titre: "Organisation",
    champs: [
      { cle: "unite_ids", label: "Unités organisationnelles", table: "collaborateur_affectations", colonne: "unite_id" },
    ],
  },
  {
    titre: "Contrat",
    champs: [
      { cle: "types_contrat", label: "Types de contrat", table: "collaborateur_contrats", colonne: "code_type_contrat" },
      { cle: "temps", label: "Temps de travail", table: "collaborateur_contrats", colonne: "code_temps" },
    ],
  },
  {
    titre: "Collaborateur",
    champs: [
      { cle: "statuts_collaborateur", label: "Statuts collaborateur", table: "collaborateurs", colonne: "statut_collaborateur" },
      { cle: "regimes", label: "Régimes de cotisation", table: "collaborateur_regime", colonne: "code_regime" },
      { cle: "nationalites", label: "Nationalités", table: "collaborateurs", colonne: "code_nationalite" },
    ],
  },
  {
    titre: "Classification",
    champs: [
      { cle: "codes_emploi", label: "Emploi", table: "collaborateur_affectations", colonne: "code_emploi" },
      { cle: "codes_fonction", label: "Fonctions", table: "collaborateur_qualifications", colonne: "code_fonction" },
      { cle: "codes_categorie_professionnelle", label: "Catégories professionnelles", table: "collaborateur_qualifications", colonne: "code_categorie_professionnelle" },
      { cle: "codes_college", label: "Collèges", table: "collaborateur_qualifications", colonne: "code_college" },
      { cle: "codes_responsabilite", label: "Responsabilités", table: "collaborateur_qualifications", colonne: "code_responsabilite" },
      { cle: "codes_niveau", label: "Niveaux", table: "collaborateur_qualifications", colonne: "code_niveau" },
      { cle: "codes_grade", label: "Grades", table: "collaborateur_qualifications", colonne: "code_grade" },
      { cle: "codes_echelle", label: "Échelles", table: "collaborateur_qualifications", colonne: "code_echelle" },
      { cle: "codes_classe", label: "Classes", table: "collaborateur_qualifications", colonne: "code_classe" },
      { cle: "echelons", label: "Échelons", table: "collaborateur_qualifications", colonne: "echelon_actuel" },
      { cle: "codes_filiere", label: "Filières", table: "collaborateur_qualifications", colonne: "code_filiere" },
      { cle: "codes_activite", label: "Activités", table: "collaborateur_qualifications", colonne: "code_activite" },
    ],
  },
];

/**
 * Menu déroulant multi-sélection avec recherche par saisie, résolu
 * dynamiquement via l'introspection de clé étrangère (déjà utilisée par
 * EditeurSurcharges.tsx pour les champs de contrat simulables — même
 * mécanisme, réutilisé tel quel). Si la colonne source n'a AUCUNE FK
 * réelle (`a_un_referentiel: false`), retombe automatiquement sur une
 * saisie libre de codes séparés par des virgules — jamais de plantage,
 * jamais de nom de référentiel deviné.
 */
/**
 * Menu compact « + Ajouter un critère » — révèle à la demande un champ
 * actuellement sans valeur (modèle Odoo : ne montrer que ce qui est
 * réellement configuré, garder le reste accessible en un clic plutôt que
 * d'imposer une longue liste de menus vides à l'écran en permanence).
 * Entièrement générique sur la liste de champs fournie — un nouveau champ
 * ajouté à GROUPES_CRITERES apparaît ici automatiquement, sans changement
 * à ce composant (RG-POPULATION-UX-01, "très évolutive").
 */
function SelecteurAjoutCritere({
  champs, onAjouter,
}: { champs: { cle: string; label: string }[]; onAjouter: (cle: string) => void }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary/40 px-2.5 py-1 text-xs text-primary hover:bg-primary/5 transition-colors"
      >
        <Plus className="h-3 w-3" /> Ajouter un critère
      </button>
      {ouvert && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOuvert(false)} />
          <div className="absolute z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-md border bg-background shadow-lg py-1">
            {champs.map((c) => (
              <button
                key={c.cle}
                type="button"
                onClick={() => { onAjouter(c.cle); setOuvert(false); }}
                className="block w-full text-left px-3 py-1.5 text-xs hover:bg-muted/60 transition-colors"
              >
                {c.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ReferentielMultiSelect({ table, colonne, valeurs, onChange }: {
  table: string; colonne: string; valeurs: string[] | undefined; onChange: (v: string[]) => void;
}) {
  // Défensif : le champ peut être absent de la réponse backend tant que le
  // schéma correspondant n'a pas suivi un renommage côté base (ex.
  // codes_poste → codes_emploi, en attente de app/schemas/paie_calcul.py)
  // — ne doit jamais faire planter l'écran, juste se comporter comme
  // "aucune valeur sélectionnée".
  const valeursSures = valeurs ?? [];
  const [chargement, setChargement] = useState(true);
  const [aUnReferentiel, setAUnReferentiel] = useState(false);
  const [options, setOptions] = useState<ValeurReferentielle[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [texteLibre, setTexteLibre] = useState(valeursSures.join(", "));
  const [replies, setReplies] = useState<Set<string>>(new Set());

  useEffect(() => {
    setChargement(true);
    valeursReferentielChamp(table, colonne)
      .then((res) => { setAUnReferentiel(res.a_un_referentiel); setOptions(res.valeurs); })
      .catch(() => setAUnReferentiel(false))
      .finally(() => setChargement(false));
  }, [table, colonne]);

  if (chargement) {
    return <div className="h-9 rounded-md border bg-muted/30 animate-pulse" />;
  }

  if (!aUnReferentiel) {
    return (
      <Input
        value={texteLibre}
        onChange={(e) => {
          setTexteLibre(e.target.value);
          onChange(e.target.value.split(",").map((v) => v.trim()).filter(Boolean));
        }}
        placeholder="Codes séparés par des virgules (aucun référentiel détecté pour ce champ)"
      />
    );
  }

  // Hiérarchie auto-détectée : présente dès qu'AU MOINS une valeur porte un
  // parent_id non nul (backend : colonne parent_id détectée sur la table
  // référencée — ex. unites_organisationnelles). Un référentiel plat
  // (parent_id toujours null) garde l'affichage en liste simple.
  const estHierarchique = options.some((o) => o.parent_id !== null);

  function basculer(code: string) {
    onChange(valeursSures.includes(code) ? valeursSures.filter((v) => v !== code) : [...valeursSures, code]);
  }
  function basculerRepli(code: string) {
    setReplies((r) => { const n = new Set(r); n.has(code) ? n.delete(code) : n.add(code); return n; });
  }

  const selectionnees = options.filter((o) => valeursSures.includes(o.code));
  const rechercheActive = recherche.trim().length > 0;
  const filtrees = rechercheActive
    ? options.filter((o) => o.libelle.toLowerCase().includes(recherche.toLowerCase()) || o.code.toLowerCase().includes(recherche.toLowerCase()))
    : options;

  const enfantsParParent = new Map<string | null, ValeurReferentielle[]>();
  for (const o of options) {
    const cle = o.parent_id;
    if (!enfantsParParent.has(cle)) enfantsParParent.set(cle, []);
    enfantsParParent.get(cle)!.push(o);
  }

  function ligne(o: ValeurReferentielle, profondeur: number) {
    const coche = valeursSures.includes(o.code);
    const enfants = enfantsParParent.get(o.code) ?? [];
    const replie = replies.has(o.code);
    return (
      <div key={o.code}>
        <div className="flex items-center gap-1 px-1 py-0.5" style={{ paddingLeft: 8 + profondeur * 16 }}>
          {enfants.length > 0 ? (
            <button type="button" onClick={() => basculerRepli(o.code)} className="p-0.5 text-muted-foreground shrink-0">
              <ChevronDown className={`h-3 w-3 transition-transform ${replie ? "-rotate-90" : ""}`} />
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <button
            type="button"
            onClick={() => basculer(o.code)}
            className="flex flex-1 items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-muted/50"
          >
            <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${coche ? "bg-secondary border-secondary" : "border-border"}`}>
              {coche && <Check className="h-2.5 w-2.5 text-secondary-foreground" />}
            </span>
            {o.libelle}
          </button>
        </div>
        {!replie && enfants.map((e) => ligne(e, profondeur + 1))}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        className="flex h-9 w-full items-center justify-between rounded-md border bg-background px-3 text-sm"
      >
        <span className="truncate text-left">
          {selectionnees.length === 0 ? "Tous (aucun filtre)" : selectionnees.map((o) => o.libelle).join(", ")}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      {ouvert && (
        <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-md">
          <div className="p-1.5 border-b">
            <input
              autoFocus
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Rechercher…"
              className="h-8 w-full rounded border px-2 text-xs"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtrees.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">Aucun résultat.</p>
            ) : estHierarchique && !rechercheActive ? (
              // Arborescence : uniquement les racines (parent_id absent des
              // options chargées, ou parent_id null) — leurs enfants sont
              // rendus récursivement par ligne().
              (enfantsParParent.get(null) ?? []).map((racine) => ligne(racine, 0))
            ) : (
              // Recherche active (ou référentiel plat) : liste filtrée à
              // plat — plus simple et plus utile pour retrouver un élément
              // profond dans l'arbre sans déplier manuellement.
              filtrees.map((o) => {
                const coche = valeursSures.includes(o.code);
                return (
                  <button
                    key={o.code}
                    type="button"
                    onClick={() => basculer(o.code)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/50"
                  >
                    <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${coche ? "bg-secondary border-secondary" : "border-border"}`}>
                      {coche && <Check className="h-2.5 w-2.5 text-secondary-foreground" />}
                    </span>
                    {o.libelle}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EditeurPopulation({
  population,
  onFerme,
  onEnregistre,
}: {
  population: PopulationPaieRead | null;
  onFerme: () => void;
  onEnregistre: (id: string) => void;
}) {
  const [code, setCode] = useState(population?.code ?? "");
  const [libelle, setLibelle] = useState(population?.libelle ?? "");
  const [mode, setMode] = useState<ModePopulation>(population?.mode ?? "CRITERES");
  const [conditionSql, setConditionSql] = useState(population?.condition_sql ?? "");
  const [actif, setActif] = useState(population?.actif ?? true);
  const [criteres, setCriteres] = useState(population?.criteres ?? criteresVides());
  const [champsReveles, setChampsReveles] = useState<Set<string>>(new Set());
  const [apercuListe, setApercuListe] = useState<CollaborateurCible[] | null>(null);
  const [apercuListeVisible, setApercuListeVisible] = useState(false);
  const [apercuRecherche, setApercuRecherche] = useState("");
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreurLocale, setErreurLocale] = useState<string | null>(null);

  function majCriteres(cle: keyof ReturnType<typeof criteresVides>, valeurs: string[]) {
    setCriteres((c) => ({ ...c, [cle]: valeurs }));
    setApercuListe(null);
    setApercuListeVisible(false);
  }

  async function tester() {
    setErreurLocale(null);
    try {
      const cibles = await apercuPopulation(
        mode === "SQL" ? { mode, condition_sql: conditionSql } : { mode, criteres }
      );
      setApercuListe(cibles);
    } catch (e) {
      setErreurLocale(e instanceof Error ? e.message : "Erreur d'aperçu");
    }
  }

  async function enregistrer() {
    if (!code.trim() || !libelle.trim()) {
      setErreurLocale("Code et libellé sont requis.");
      return;
    }
    setEnregistrement(true);
    setErreurLocale(null);
    const data: PopulationPaieWrite = {
      code: code.trim(), libelle: libelle.trim(), mode,
      condition_sql: mode === "SQL" ? conditionSql : null,
      actif, criteres,
    };
    try {
      const res = population ? await modifierPopulation(population.id, data) : await creerPopulation(data);
      onEnregistre(res.id);
    } catch (e) {
      setErreurLocale(e instanceof Error ? e.message : "Erreur d'enregistrement");
    } finally {
      setEnregistrement(false);
    }
  }

  return (
    <div className="rounded-md border bg-muted/20 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{population ? `Modifier « ${population.libelle} »` : "Nouvelle population"}</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onFerme}><X className="h-4 w-4" /></Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Code</label>
          <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={!!population} placeholder="Ex. CADRES_CASA" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Libellé</label>
          <Input value={libelle} onChange={(e) => setLibelle(e.target.value)} placeholder="Ex. Cadres — Casablanca" />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 text-sm">
          <input type="radio" checked={mode === "CRITERES"} onChange={() => setMode("CRITERES")} /> Critères
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="radio" checked={mode === "SQL"} onChange={() => setMode("SQL")} /> Condition SQL
        </label>
        <label className="ml-auto flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={actif} onChange={(e) => setActif(e.target.checked)} /> Active
        </label>
      </div>

      {mode === "SQL" ? (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Condition SQL (expression booléenne, colonnes de `collaborateurs` — pas de requête libre)
          </label>
          <textarea
            className="w-full min-h-20 rounded-md border bg-background p-2 text-xs font-mono"
            value={conditionSql}
            onChange={(e) => setConditionSql(e.target.value)}
            placeholder="ex. c.code_nationalite = 'MA'"
          />
        </div>
      ) : (
        <div className="space-y-3">
          {GROUPES_CRITERES.map((groupe) => {
            const actifs = groupe.champs.filter((c) => (criteres[c.cle]?.length ?? 0) > 0 || champsReveles.has(c.cle));
            const inactifs = groupe.champs.filter((c) => !actifs.includes(c));
            const nbActifs = groupe.champs.filter((c) => (criteres[c.cle]?.length ?? 0) > 0).length;
            return (
              <details key={groupe.titre} className="rounded-md border" open={nbActifs > 0}>
                <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <ChevronDown className="h-3.5 w-3.5" /> {groupe.titre}
                  {nbActifs > 0 && (
                    <span className="rounded-full bg-primary/15 px-1.5 py-0 text-[10px] font-bold text-primary normal-case tracking-normal">{nbActifs}</span>
                  )}
                </summary>
                <div className="p-3 space-y-3 border-t">
                  {actifs.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">Aucun critère de ce type — la population reste ouverte sur cette dimension.</p>
                  ) : (
                    actifs.map((champ) => (
                      <div key={champ.cle} className="flex items-start gap-2">
                        <div className="flex-1 space-y-1">
                          <label className="text-xs text-muted-foreground">{champ.label}</label>
                          <ReferentielMultiSelect
                            table={champ.table}
                            colonne={champ.colonne}
                            valeurs={criteres[champ.cle]}
                            onChange={(v) => majCriteres(champ.cle, v)}
                          />
                        </div>
                        <button
                          type="button"
                          title="Retirer ce critère"
                          onClick={() => {
                            majCriteres(champ.cle, []);
                            setChampsReveles((s) => { const n = new Set(s); n.delete(champ.cle); return n; });
                          }}
                          className="mt-5 shrink-0 rounded-full p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                  {inactifs.length > 0 && (
                    <SelecteurAjoutCritere champs={inactifs} onAjouter={(cle) => setChampsReveles((s) => new Set(s).add(cle))} />
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={tester}>Tester (aperçu)</Button>
        {apercuListe !== null && (
          <>
            <span className="text-sm text-muted-foreground">{apercuListe.length} collaborateur(s) correspondant(s)</span>
            {apercuListe.length > 0 && (
              <button
                onClick={() => setApercuListeVisible((v) => !v)}
                className="text-xs rounded-full border border-primary/40 bg-primary/5 px-2.5 py-1 text-primary font-medium hover:bg-primary/10 transition-colors"
              >
                {apercuListeVisible ? "Masquer la liste" : "Voir la liste"}
              </button>
            )}
          </>
        )}
      </div>

      {apercuListeVisible && apercuListe && apercuListe.length > 0 && (
        <ApercuPopulationListe liste={apercuListe} recherche={apercuRecherche} onRecherche={setApercuRecherche} />
      )}

      {erreurLocale && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {erreurLocale}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onFerme}>Annuler</Button>
        <Button size="sm" onClick={enregistrer} disabled={enregistrement}>
          {enregistrement && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Enregistrer
        </Button>
      </div>
    </div>
  );
}

/**
 * Liste de l'aperçu de population, à la demande — triable/filtrable, même
 * palette et mêmes composants de tri déjà en place ailleurs sur cet écran
 * (EnTeteTriableInline / useTriInline, réutilisés tels quels).
 */
function ApercuPopulationListe({
  liste, recherche, onRecherche,
}: { liste: CollaborateurCible[]; recherche: string; onRecherche: (v: string) => void }) {
  const filtree = liste.filter((c) =>
    recherche.trim() ? `${c.matricule} ${c.nom} ${c.prenom}`.toLowerCase().includes(recherche.trim().toLowerCase()) : true
  );
  const { donneesTriees, tri, basculerTri } = useTriInline(filtree as unknown as Record<string, unknown>[]);

  return (
    <div className="rounded-md border overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b bg-muted/20">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={recherche}
            onChange={(e) => onRecherche(e.target.value)}
            placeholder="Rechercher matricule, nom, prénom…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        {recherche && (
          <span className="text-xs text-muted-foreground">{filtree.length} / {liste.length} résultat(s)</span>
        )}
      </div>
      <div className="max-h-72 overflow-y-auto">
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <EnTeteTriableInline label="Matricule" cle="matricule" tri={tri} onTrier={basculerTri} />
              <EnTeteTriableInline label="Nom" cle="nom" tri={tri} onTrier={basculerTri} />
              <EnTeteTriableInline label="Unité organisationnelle" cle="unite_libelle" tri={tri} onTrier={basculerTri} />
              <EnTeteTriableInline label="Catégorie professionnelle" cle="categorie_professionnelle" tri={tri} onTrier={basculerTri} />
              <EnTeteTriableInline label="Type de contrat" cle="type_contrat" tri={tri} onTrier={basculerTri} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {donneesTriees.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">Aucun résultat.</TableCell></TableRow>
            ) : (
              donneesTriees.map((c) => (
                <TableRow key={c.id as string} className="hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">{c.matricule as string}</TableCell>
                  <TableCell className="font-medium">{c.nom as string} {c.prenom as string}</TableCell>
                  <TableCell className="text-muted-foreground">{(c.unite_libelle as string) ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{(c.categorie_professionnelle as string) ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{(c.type_contrat as string) ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ===========================================================================
// Suivi du job + résultat
// ===========================================================================
function SuiviJobEtResultat({ job, onExporter }: { job: SimulationPopulationJobStatut | null; onExporter: () => void }) {
  if (!job) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Aucun lancement pour l'instant.</p>;
  }
  if (job.statut === "ERREUR") {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        Le lancement a échoué : {job.erreur}
      </div>
    );
  }
  if (job.statut === "EN_ATTENTE" || job.statut === "EN_COURS") {
    return <SuiviProgressionJob job={job} />;
  }
  if (job.statut === "TERMINE" && job.resultat) {
    return <ResultatPopulationVue jobId={job.id} resultat={job.resultat} onExporter={onExporter} />;
  }
  return null;
}

// Messages informatifs qui tournent pendant le calcul — purement indicatif
// (le backend ne remonte pas de phase précise, juste nb_traites/nb_total),
// pour que l'attente reste lisible sur un lancement qui peut prendre du
// temps (population large × plage de périodes × scénarios).
const MESSAGES_PROGRESSION_JOB = [
  "Résolution de la population et des périodes…",
  "Calcul des bulletins « tel quel »…",
  "Application des scénarios sélectionnés…",
  "Fusion des surcharges et recalcul des cumuls annuels…",
  "Consolidation des écarts net et coût employeur…",
];

function SuiviProgressionJob({ job }: { job: SimulationPopulationJobStatut }) {
  // Horloge locale (1 s) indépendante du polling (2 s, voir INTERVALLE_POLLING_MS)
  // — le temps écoulé et le rythme doivent progresser en continu à l'œil,
  // pas par à-coups toutes les 2 secondes.
  const [maintenant, setMaintenant] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setMaintenant(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [indexMessage, setIndexMessage] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIndexMessage((i) => (i + 1) % MESSAGES_PROGRESSION_JOB.length), 2800);
    return () => clearInterval(id);
  }, []);

  const pct = job.nb_total > 0 ? Math.min(100, Math.round((job.nb_traites / job.nb_total) * 100)) : 0;
  const ecouleS = Math.max(0, Math.floor((maintenant - new Date(job.created_at).getTime()) / 1000));
  const rythme = ecouleS > 0 && job.nb_traites > 0 ? job.nb_traites / ecouleS : 0; // collaborateur(s)/s
  const restants = Math.max(0, job.nb_total - job.nb_traites);
  const etaS = rythme > 0 ? Math.ceil(restants / rythme) : null;

  const formatDuree = (s: number) => {
    const m = Math.floor(s / 60), sec = s % 60;
    return m > 0 ? `${m} min ${sec.toString().padStart(2, "0")} s` : `${sec} s`;
  };

  return (
    <div className="space-y-5 py-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
          </span>
          <span className="text-sm font-medium">
            {job.statut === "EN_ATTENTE" ? "En attente de démarrage…" : "Calcul en cours"}
          </span>
        </div>
        <span className="text-3xl font-bold tabular-nums text-primary">{pct}%</span>
      </div>

      <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md border p-2.5">
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Users className="h-3 w-3" /> Traités</div>
          <div className="font-semibold tabular-nums">{job.nb_traites} / {job.nb_total}</div>
        </div>
        <div className="rounded-md border p-2.5">
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Clock className="h-3 w-3" /> Écoulé</div>
          <div className="font-semibold tabular-nums">{formatDuree(ecouleS)}</div>
        </div>
        <div className="rounded-md border p-2.5">
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Gauge className="h-3 w-3" /> Rythme</div>
          <div className="font-semibold tabular-nums">{rythme > 0 ? `${rythme.toFixed(1)}/s` : "—"}</div>
        </div>
        <div className="rounded-md border p-2.5">
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Sparkles className="h-3 w-3" /> Restant estimé</div>
          <div className="font-semibold tabular-nums">{etaS != null ? formatDuree(etaS) : "—"}</div>
        </div>
      </div>

      <p className="text-center text-xs italic text-muted-foreground">
        {job.statut === "EN_ATTENTE" ? "Préparation du lancement…" : MESSAGES_PROGRESSION_JOB[indexMessage]}
      </p>
    </div>
  );
}

export function ResultatPopulationVue({ jobId, resultat, onExporter }: { jobId: string; resultat: SimulationPopulationResult; onExporter: () => void }) {
  const fmt = (v: string | null) => (v == null ? "—" : parseFloat(v).toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const ecartCouleur = (v: string | null) => {
    if (v == null) return undefined;
    const n = parseFloat(v);
    return n === 0 ? undefined : n > 0 ? "hsl(var(--success, 142 71% 35%))" : "hsl(var(--destructive))";
  };
  const plage = resultat.periode_debut_libelle === resultat.periode_fin_libelle
    ? resultat.periode_debut_libelle
    : `${resultat.periode_debut_libelle} → ${resultat.periode_fin_libelle}`;

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">
        Plage : <span className="font-medium text-foreground">{plage}</span> ({resultat.nb_periodes} période(s) cumulée(s))
      </p>

      {!resultat.avec_ecarts && (
        <div className="rounded-md border border-muted-foreground/20 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Écarts non affichés (option décochée au lancement) — seuls les montants « après scénario » sont disponibles.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 rounded-md border p-4 sm:grid-cols-4">
        <div>
          <div className="text-xs text-muted-foreground">Collaborateurs</div>
          <div className="text-lg font-semibold tabular-nums">{resultat.nb_collaborateurs}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Erreurs</div>
          <div className="text-lg font-semibold tabular-nums" style={{ color: resultat.nb_erreurs > 0 ? "hsl(var(--destructive))" : undefined }}>
            {resultat.nb_erreurs}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Net à payer — après (fusion)</div>
          <div className="text-lg font-semibold tabular-nums">{fmt(resultat.resume_fusion.net_apres)}</div>
          {resultat.avec_ecarts && (
            <div className="text-xs tabular-nums mt-0.5" style={{ color: ecartCouleur(resultat.resume_fusion.ecart_net) }}>
              écart {fmt(resultat.resume_fusion.ecart_net)}
            </div>
          )}
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Coût employeur — masse salariale (après)</div>
          <div className="text-lg font-semibold tabular-nums">{fmt(resultat.resume_fusion.cout_employeur_apres)}</div>
          {resultat.avec_ecarts && (
            <div className="text-xs tabular-nums mt-0.5" style={{ color: ecartCouleur(resultat.resume_fusion.ecart_cout_employeur) }}>
              écart {fmt(resultat.resume_fusion.ecart_cout_employeur)}
            </div>
          )}
        </div>
      </div>

      {resultat.resume_par_scenario.length > 0 && (
        <div className="rounded-md border">
          <div className="px-3 pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Résumé par scénario (chacun appliqué séparément)
          </div>
          <Table className="text-sm">
            <TableHeader>
              <TableRow>
                <TableHead>Scénario</TableHead>
                <TableHead className="text-right">Net après</TableHead>
                <TableHead className="text-right">Écart net</TableHead>
                <TableHead className="text-right">Coût après</TableHead>
                <TableHead className="text-right">Écart coût</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resultat.resume_par_scenario.map((rs) => (
                <TableRow key={rs.scenario_id}>
                  <TableCell className="font-medium">{rs.scenario_nom}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(rs.net_apres)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums" style={{ color: ecartCouleur(rs.ecart_net) }}>
                    {fmt(rs.ecart_net)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(rs.cout_employeur_apres)}</TableCell>
                  <TableCell className="text-right tabular-nums" style={{ color: ecartCouleur(rs.ecart_cout_employeur) }}>
                    {fmt(rs.ecart_cout_employeur)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onExporter}>
          <FileDown className="mr-2 h-4 w-4" /> Exporter Excel
        </Button>
      </div>

      <ListeBulletinsSimules jobId={jobId} scenarios={resultat.scenarios} />
    </div>
  );
}

// ===========================================================================
// Liste des bulletins simulés — regroupable (aucun/UO/période/année/mois/
// collaborateur), triable sur toutes les colonnes, avec KPI récapitulatifs
// sur la vue groupée, drill-down au clic sur un groupe, et détail complet
// des rubriques (façon vrai bulletin) au clic sur un bulletin individuel
// (RG-SIM-POPULATION-03).
// ===========================================================================
const LIBELLES_REGROUPEMENT: Record<ModeRegroupementBulletins, string> = {
  aucun: "Liste à plat",
  uo: "Par unité organisationnelle",
  periode: "Par période",
  annee: "Par année",
  mois: "Par mois",
  collaborateur: "Par collaborateur",
};

/**
 * Tri générique, ENTIÈREMENT AUTO-SUFFISANT dans ce fichier (aucune
 * dépendance vers un hook/composant séparé) — après deux incidents où un
 * fichier externe (useSortableTable.ts / EnTeteTriable.tsx) référencé mais
 * jamais réellement présent sur le poste de déploiement a fait planter tout
 * l'écran (ReferenceError), le tri est réimplémenté ici même. Un seul
 * fichier à déployer pour tout l'écran, plus aucun risque de ce type.
 */
type SensTriInline = "asc" | "desc";
type TriInline = { cle: string; sens: SensTriInline } | null;

function trierLignes<T extends Record<string, unknown>>(lignes: T[], tri: TriInline): T[] {
  if (!tri) return lignes;
  const { cle, sens } = tri;
  return [...lignes].sort((a, b) => {
    const va = a[cle], vb = b[cle];
    let cmp: number;
    if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
    else {
      const na = parseFloat(String(va)), nb = parseFloat(String(vb));
      cmp = !isNaN(na) && !isNaN(nb) && String(va).trim() !== "" && String(vb).trim() !== ""
        ? na - nb
        : String(va ?? "").localeCompare(String(vb ?? ""));
    }
    return sens === "asc" ? cmp : -cmp;
  });
}

function EnTeteTriableInline({ label, cle, tri, onTrier, align = "left", className = "" }: {
  label: string; cle: string; tri: TriInline; onTrier: (cle: string) => void; align?: "left" | "right"; className?: string;
}) {
  const actif = tri?.cle === cle;
  return (
    <TableHead className={`${align === "right" ? "text-right" : "text-left"} ${className}`}>
      <button
        onClick={() => onTrier(cle)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${align === "right" ? "flex-row-reverse" : ""} ${actif ? "text-primary font-medium" : "text-muted-foreground"}`}
      >
        {label}
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${actif ? "opacity-100" : "opacity-30"} ${actif && tri!.sens === "asc" ? "rotate-180" : ""}`} />
      </button>
    </TableHead>
  );
}

function useTriInline<T extends Record<string, unknown>>(lignes: T[]) {
  const [tri, setTri] = useState<TriInline>(null);
  function basculerTri(cle: string) {
    setTri((t) => (t?.cle === cle ? (t.sens === "asc" ? { cle, sens: "desc" } : null) : { cle, sens: "asc" }));
  }
  return { donneesTriees: trierLignes(lignes, tri), tri, basculerTri };
}

export function ListeBulletinsSimules({ jobId, scenarios }: { jobId: string; scenarios: { id: string; nom: string }[] }) {

  const [mode, setMode] = useState<ModeRegroupementBulletins>(chargerPrefsSimulationPopulation().modeRegroupement ?? "collaborateur");
  const [filtreDrillDown, setFiltreDrillDown] = useState<{
    unite_libelle?: string; periode_id?: string; annee?: number; mois?: number; collaborateur_id?: string; libelleAffiche: string;
  } | null>(null);
  const [groupes, setGroupes] = useState<(GroupeBulletinsPopulation & { annee_num?: number; mois_num?: number; ordre_chronologique?: number })[] | null>(null);
  const [bulletins, setBulletins] = useState<BulletinSimulePopulation[] | null>(null);
  const [chargement, setChargement] = useState(true);
  const [bulletinOuvertId, setBulletinOuvertId] = useState<string | null>(null);

  // Barre de recherche/filtres façon Odoo — s'applique côté client sur la
  // liste PLATE actuellement affichée (mode "aucun" ou après drill-down sur
  // un groupe) ; sans effet sur la vue agrégée elle-même (les totaux des
  // groupes restent ceux du serveur, non filtrés — chercher/filtrer n'a de
  // sens qu'une fois qu'on regarde des bulletins individuels).
  const [recherche, setRecherche] = useState("");
  const [filtresRapides, setFiltresRapides] = useState<Set<"erreurs" | "exclus" | "ecart">>(new Set());

  function basculerFiltreRapide(cle: "erreurs" | "exclus" | "ecart") {
    setFiltresRapides((f) => {
      const n = new Set(f);
      n.has(cle) ? n.delete(cle) : n.add(cle);
      return n;
    });
  }

  function charger() {
    setChargement(true);
    const filtres = filtreDrillDown
      ? {
          unite_libelle: filtreDrillDown.unite_libelle, periode_id: filtreDrillDown.periode_id,
          annee: filtreDrillDown.annee, mois: filtreDrillDown.mois, collaborateur_id: filtreDrillDown.collaborateur_id,
        }
      : undefined;
    listerBulletinsPopulation(jobId, mode, filtres)
      .then((res) => {
        let groupesAugmentes = res.groupes;
        if (mode === "mois" && res.groupes) {
          groupesAugmentes = res.groupes.map((g) => {
            const [anneeStr, moisStr] = g.cle_filtre.split("-");
            return { ...g, annee_num: Number(anneeStr), mois_num: Number(moisStr) };
          });
        } else if (mode === "periode" && res.groupes) {
          groupesAugmentes = res.groupes.map((g) => {
            const prefixeOrdre = g.cle_filtre.split("::")[0];
            return { ...g, ordre_chronologique: Number(prefixeOrdre) };
          });
        }
        setGroupes(groupesAugmentes);
        setBulletins(res.bulletins);
      })
      .catch(() => { setGroupes(null); setBulletins(null); })
      .finally(() => setChargement(false));
  }

  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, mode, filtreDrillDown]);

  function ouvrirGroupe(g: GroupeBulletinsPopulation) {
    if (mode === "uo") setFiltreDrillDown({ unite_libelle: g.cle_filtre, libelleAffiche: g.cle });
    else if (mode === "periode") setFiltreDrillDown({ periode_id: g.cle_filtre.split("::")[1], libelleAffiche: g.cle });
    else if (mode === "annee") setFiltreDrillDown({ annee: Number(g.cle_filtre), libelleAffiche: g.cle });
    else if (mode === "mois") {
      // cle_filtre backend au format "AAAA-M" (ex. "2026-7") depuis la
      // correction du regroupement mensuel — voir RG-SIM-POPULATION-03,
      // qui isole désormais chaque (année, mois) au lieu de cumuler un même
      // mois calendaire à travers toutes les années de la plage.
      const [anneeStr, moisStr] = g.cle_filtre.split("-");
      setFiltreDrillDown({ annee: Number(anneeStr), mois: Number(moisStr), libelleAffiche: g.cle });
    }
    else if (mode === "collaborateur") setFiltreDrillDown({ collaborateur_id: g.cle_filtre, libelleAffiche: g.cle });
  }

  function changerMode(m: ModeRegroupementBulletins) {
    setMode(m);
    setFiltreDrillDown(null);
    sauverPrefsSimulationPopulation({ modeRegroupement: m });
  }

  const fmt = (v: string | null) => (v == null ? "—" : parseFloat(v).toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const ecartCouleur = (v: string | null) => {
    if (v == null) return undefined;
    const n = parseFloat(v);
    return n === 0 ? undefined : n > 0 ? "hsl(var(--success, 142 71% 35%))" : "hsl(var(--destructive))";
  };

  // Situation collaborateur (contrat/collège/catégorie/emploi) : affiche la
  // valeur "avant" seule si inchangée, ou "avant → après" en évidence si un
  // scénario du job l'a surchargée — même esprit que l'écart net/coût.
  function situationCell(avant?: string | null, apres?: string | null) {
    if (!avant && !apres) return <span className="text-muted-foreground">—</span>;
    if (!apres || apres === avant) return <>{avant ?? "—"}</>;
    return (
      <span>
        <span className="text-muted-foreground line-through">{avant ?? "—"}</span>
        {" → "}
        <span className="font-medium text-primary">{apres}</span>
      </span>
    );
  }

  // KPI récapitulatifs sur la vue groupée courante — somme des groupes affichés à l'écran.
  // net_avant est null pour tout le job dès que "Calculer les écarts" est
  // décoché (RG-SIM-POPULATION-11) — parseFloat(null) vaudrait NaN et le
  // propagerait à toute la somme ; on distingue donc explicitement "aucun
  // écart disponible" (affiché "—") de "écart calculé".
  const kpiGroupes = groupes && !filtreDrillDown
    ? {
        nbBulletins: groupes.reduce((s, g) => s + g.nb_bulletins, 0),
        nbErreurs: groupes.reduce((s, g) => s + g.nb_erreurs, 0),
        netAvant: groupes.every((g) => g.net_avant != null) ? groupes.reduce((s, g) => s + parseFloat(g.net_avant as string), 0) : null,
        netApres: groupes.reduce((s, g) => s + parseFloat(g.net_apres_fusion), 0),
      }
    : null;

  const bulletinsFiltres = (bulletins ?? []).filter((b) => {
    if (recherche.trim()) {
      const q = recherche.trim().toLowerCase();
      const cible = `${b.matricule} ${b.nom} ${b.prenom} ${b.unite_libelle ?? ""}`.toLowerCase();
      if (!cible.includes(q)) return false;
    }
    if (filtresRapides.has("erreurs") && !b.a_erreur) return false;
    if (filtresRapides.has("exclus") && !b.exclu_projection) return false;
    if (filtresRapides.has("ecart") && (b.ecart_net_fusion == null || parseFloat(b.ecart_net_fusion) === 0)) return false;
    return true;
  });

  const { donneesTriees: groupesTries, tri: triGroupe, basculerTri: basculerTriGroupe } = useTriInline(groupes ?? []);
  const { donneesTriees: bulletinsTries, tri: triBulletin, basculerTri: basculerTriBulletin } = useTriInline(bulletinsFiltres);
  const vueBulletins = !groupes || !!filtreDrillDown; // liste plate affichée (pas la vue agrégée)

  return (
    <div className="rounded-md border overflow-x-auto">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3 pb-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Paies simulées — {filtreDrillDown ? filtreDrillDown.libelleAffiche : LIBELLES_REGROUPEMENT[mode]}
        </div>
        <div className="flex items-center gap-1">
          {filtreDrillDown && (
            <Button variant="ghost" size="sm" onClick={() => setFiltreDrillDown(null)}>
              <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Retour aux groupes
            </Button>
          )}
          <div className="inline-flex rounded-md border bg-card p-0.5 text-xs">
            {(Object.keys(LIBELLES_REGROUPEMENT) as ModeRegroupementBulletins[]).map((m) => (
              <button
                key={m}
                onClick={() => changerMode(m)}
                className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap ${mode === m ? "bg-primary text-primary-foreground font-medium shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"}`}
              >
                {LIBELLES_REGROUPEMENT[m]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Barre de recherche/filtres façon Odoo — visible uniquement sur une
          liste plate de bulletins (pas sur la vue agrégée par groupe, où
          filtrer n'aurait pas de sens tant qu'on n'a pas ouvert un groupe). */}
      {vueBulletins && (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Rechercher matricule, nom, unité…"
              className="h-8 w-full rounded-md border bg-background pl-2.5 pr-2.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="flex items-center gap-1">
            {([
              { cle: "erreurs" as const, label: "Erreurs" },
              { cle: "exclus" as const, label: "Exclus (projection)" },
              { cle: "ecart" as const, label: "Écart ≠ 0" },
            ]).map((f) => {
              const actif = filtresRapides.has(f.cle);
              return (
                <button
                  key={f.cle}
                  onClick={() => basculerFiltreRapide(f.cle)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    actif ? "border-accent bg-accent/10 text-accent-foreground font-medium" : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {actif && <Check className="h-3 w-3" />}
                  {f.label}
                </button>
              );
            })}
            {(recherche || filtresRapides.size > 0) && (
              <button
                onClick={() => { setRecherche(""); setFiltresRapides(new Set()); }}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                Effacer
              </button>
            )}
          </div>
          {(recherche || filtresRapides.size > 0) && (
            <span className="text-xs text-muted-foreground ml-auto">{bulletinsFiltres.length} résultat{bulletinsFiltres.length > 1 ? "s" : ""}</span>
          )}
        </div>
      )}

      {kpiGroupes && (
        <div className="grid grid-cols-2 gap-3 px-3 pb-3 sm:grid-cols-4">
          <div className="rounded-md border p-2">
            <div className="text-xs text-muted-foreground">Groupes</div>
            <div className="font-semibold tabular-nums">{groupes!.length}</div>
          </div>
          <div className="rounded-md border p-2">
            <div className="text-xs text-muted-foreground">Bulletins</div>
            <div className="font-semibold tabular-nums">{kpiGroupes.nbBulletins}</div>
          </div>
          <div className="rounded-md border p-2">
            <div className="text-xs text-muted-foreground">Erreurs</div>
            <div className="font-semibold tabular-nums" style={{ color: kpiGroupes.nbErreurs > 0 ? "hsl(var(--destructive))" : undefined }}>{kpiGroupes.nbErreurs}</div>
          </div>
          <div className="rounded-md border p-2">
            <div className="text-xs text-muted-foreground">Écart net (total)</div>
            <div
              className="font-semibold tabular-nums"
              style={{ color: kpiGroupes.netAvant != null ? ecartCouleur(String(kpiGroupes.netApres - kpiGroupes.netAvant)) : undefined }}
            >
              {kpiGroupes.netAvant != null ? fmt(String(kpiGroupes.netApres - kpiGroupes.netAvant)) : "—"}
            </div>
          </div>
        </div>
      )}

      {chargement ? (
        <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : groupes && !filtreDrillDown ? (
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              {mode === "mois" ? (
                <>
                  <EnTeteTriableInline label="Année" cle="annee_num" tri={triGroupe} onTrier={basculerTriGroupe} align="right" />
                  <EnTeteTriableInline label="Mois" cle="mois_num" tri={triGroupe} onTrier={basculerTriGroupe} align="right" />
                </>
              ) : (
                <EnTeteTriableInline
                  label={LIBELLES_REGROUPEMENT[mode]}
                  cle={mode === "periode" ? "ordre_chronologique" : "cle"}
                  tri={triGroupe}
                  onTrier={basculerTriGroupe}
                />
              )}
              {mode === "collaborateur" && (
                <>
                  <EnTeteTriableInline label="Contrat" cle="type_contrat_avant" tri={triGroupe} onTrier={basculerTriGroupe} className="border-l" />
                  <EnTeteTriableInline label="Collège" cle="college_avant" tri={triGroupe} onTrier={basculerTriGroupe} />
                  <EnTeteTriableInline label="Catégorie pro." cle="categorie_professionnelle_avant" tri={triGroupe} onTrier={basculerTriGroupe} />
                  <EnTeteTriableInline label="Emploi" cle="libelle_emploi_avant" tri={triGroupe} onTrier={basculerTriGroupe} />
                </>
              )}
              <EnTeteTriableInline label="Bulletins" cle="nb_bulletins" tri={triGroupe} onTrier={basculerTriGroupe} align="right" />
              <EnTeteTriableInline label="Erreurs" cle="nb_erreurs" tri={triGroupe} onTrier={basculerTriGroupe} align="right" />
              <EnTeteTriableInline label="Exclus (projection)" cle="nb_exclus_projection" tri={triGroupe} onTrier={basculerTriGroupe} align="right" />
              <EnTeteTriableInline label="Net avant" cle="net_avant" tri={triGroupe} onTrier={basculerTriGroupe} align="right" className="border-l" />
              <EnTeteTriableInline label="Net après (fusion)" cle="net_apres_fusion" tri={triGroupe} onTrier={basculerTriGroupe} align="right" />
              <EnTeteTriableInline label="Écart net" cle="ecart_net_fusion" tri={triGroupe} onTrier={basculerTriGroupe} align="right" />
              <EnTeteTriableInline label="Coût employeur avant" cle="cout_employeur_avant" tri={triGroupe} onTrier={basculerTriGroupe} align="right" className="border-l" />
              <EnTeteTriableInline label="Coût employeur — masse salariale (après)" cle="cout_employeur_apres_fusion" tri={triGroupe} onTrier={basculerTriGroupe} align="right" />
              <EnTeteTriableInline label="Écart coût employeur" cle="ecart_cout_employeur_fusion" tri={triGroupe} onTrier={basculerTriGroupe} align="right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {groupesTries.length === 0 ? (
              <TableRow><TableCell colSpan={mode === "mois" ? 11 : mode === "collaborateur" ? 14 : 10} className="text-center py-6 text-muted-foreground">Aucun bulletin.</TableCell></TableRow>
            ) : (
              groupesTries.map((g) => (
                <TableRow key={g.cle_filtre || g.cle} className="cursor-pointer hover:bg-muted/40" onClick={() => ouvrirGroupe(g)}>
                  {mode === "mois" ? (
                    <>
                      <TableCell className="text-right tabular-nums">{g.annee_num}</TableCell>
                      <TableCell className="font-medium text-right">{MOIS_COURT[g.mois_num ?? 0]}</TableCell>
                    </>
                  ) : (
                    <TableCell className="font-medium">{g.cle}</TableCell>
                  )}
                  {mode === "collaborateur" && (
                    <>
                      <TableCell className="border-l">{situationCell(g.type_contrat_avant, g.type_contrat_apres)}</TableCell>
                      <TableCell>{situationCell(g.college_avant, g.college_apres)}</TableCell>
                      <TableCell>{situationCell(g.categorie_professionnelle_avant, g.categorie_professionnelle_apres)}</TableCell>
                      <TableCell>
                        {situationCell(
                          g.code_emploi_avant ? `${g.code_emploi_avant} — ${g.libelle_emploi_avant ?? ""}` : null,
                          g.code_emploi_apres ? `${g.code_emploi_apres} — ${g.libelle_emploi_apres ?? ""}` : null,
                        )}
                      </TableCell>
                    </>
                  )}
                  <TableCell className="text-right tabular-nums">{g.nb_bulletins}</TableCell>
                  <TableCell className="text-right tabular-nums" style={{ color: g.nb_erreurs > 0 ? "hsl(var(--destructive))" : undefined }}>{g.nb_erreurs}</TableCell>
                  <TableCell className="text-right tabular-nums" style={{ color: g.nb_exclus_projection > 0 ? "hsl(var(--warning, 38 92% 40%))" : undefined }}>{g.nb_exclus_projection}</TableCell>
                  <TableCell className="text-right tabular-nums border-l">{fmt(g.net_avant)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(g.net_apres_fusion)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums" style={{ color: ecartCouleur(g.ecart_net_fusion) }}>{fmt(g.ecart_net_fusion)}</TableCell>
                  <TableCell className="text-right tabular-nums border-l">{fmt(g.cout_employeur_avant)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(g.cout_employeur_apres_fusion)}</TableCell>
                  <TableCell className="text-right tabular-nums" style={{ color: ecartCouleur(g.ecart_cout_employeur_fusion) }}>{fmt(g.ecart_cout_employeur_fusion)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      ) : (
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <EnTeteTriableInline label="Matricule" cle="matricule" tri={triBulletin} onTrier={basculerTriBulletin} />
              <EnTeteTriableInline label="Nom" cle="nom" tri={triBulletin} onTrier={basculerTriBulletin} />
              <EnTeteTriableInline label="Unité" cle="unite_libelle" tri={triBulletin} onTrier={basculerTriBulletin} />
              <EnTeteTriableInline label="Contrat" cle="type_contrat_avant" tri={triBulletin} onTrier={basculerTriBulletin} />
              <EnTeteTriableInline label="Collège" cle="college_avant" tri={triBulletin} onTrier={basculerTriBulletin} />
              <EnTeteTriableInline label="Catégorie pro." cle="categorie_professionnelle_avant" tri={triBulletin} onTrier={basculerTriBulletin} />
              <EnTeteTriableInline label="Emploi" cle="libelle_emploi_avant" tri={triBulletin} onTrier={basculerTriBulletin} />
              <EnTeteTriableInline label="Année" cle="periode_annee" tri={triBulletin} onTrier={basculerTriBulletin} align="right" />
              <EnTeteTriableInline label="Mois" cle="periode_mois" tri={triBulletin} onTrier={basculerTriBulletin} align="right" />
              <EnTeteTriableInline label="Net avant" cle="net_avant" tri={triBulletin} onTrier={basculerTriBulletin} align="right" className="border-l" />
              <EnTeteTriableInline label="Net après (fusion)" cle="net_apres_fusion" tri={triBulletin} onTrier={basculerTriBulletin} align="right" />
              <EnTeteTriableInline label="Écart" cle="ecart_net_fusion" tri={triBulletin} onTrier={basculerTriBulletin} align="right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {bulletinsTries.length === 0 ? (
              <TableRow><TableCell colSpan={12} className="text-center py-6 text-muted-foreground">Aucun bulletin.</TableCell></TableRow>
            ) : (
              bulletinsTries.map((b) => (
                <TableRow
                  key={b.id}
                  className={b.a_erreur || b.exclu_projection ? undefined : "cursor-pointer hover:bg-muted/40"}
                  onClick={() => !b.a_erreur && !b.exclu_projection && setBulletinOuvertId(b.id)}
                >
                  <TableCell className="font-mono text-xs">{b.matricule}</TableCell>
                  <TableCell>
                    {b.nom} {b.prenom}
                    {b.a_erreur && <div className="text-xs text-destructive mt-0.5">{b.message_erreur}</div>}
                    {b.exclu_projection && <div className="text-xs mt-0.5" style={{ color: "hsl(var(--warning, 38 92% 40%))" }}>{b.motif_exclusion}</div>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{b.unite_libelle ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{situationCell(b.type_contrat_avant, b.type_contrat_apres)}</TableCell>
                  <TableCell className="text-muted-foreground">{situationCell(b.college_avant, b.college_apres)}</TableCell>
                  <TableCell className="text-muted-foreground">{situationCell(b.categorie_professionnelle_avant, b.categorie_professionnelle_apres)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {situationCell(
                      b.code_emploi_avant ? `${b.code_emploi_avant} — ${b.libelle_emploi_avant ?? ""}` : null,
                      b.code_emploi_apres ? `${b.code_emploi_apres} — ${b.libelle_emploi_apres ?? ""}` : null,
                    )}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">{b.periode_annee}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{MOIS_COURT[b.periode_mois]}</TableCell>
                  <TableCell className="text-right tabular-nums border-l">{fmt(b.net_avant)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(b.net_apres_fusion)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums" style={{ color: ecartCouleur(b.ecart_net_fusion) }}>{fmt(b.ecart_net_fusion)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}

      {bulletinOuvertId && (
        <DetailBulletinModal bulletinId={bulletinOuvertId} scenarios={scenarios} onFermer={() => setBulletinOuvertId(null)} />
      )}
    </div>
  );
}

// ===========================================================================
// Détail d'un bulletin simulé — reconstruit sur le modèle d'un vrai bulletin
// (KPI, rubriques groupées GAINS/COTISATIONS/RETENUES/ÉLÉMENTS & BASES avec
// sous-totaux, barre de totaux en bas). Les totaux (Brut imposable, Net
// imposable, etc.) viennent TOUJOURS de totaux_avant/totaux_apres_fusion
// (calculés par le vrai moteur) — jamais reconstruits depuis les lignes,
// des règles fiscales comme "imposable ou non" n'étant pas déductibles de
// façon fiable depuis sens/est_cotisation seuls.
//
// ⚠️ Non repris du modèle de référence (Adil DAIA) : la comparaison "vs
// période précédente" sur les cartes KPI — nécessiterait de calculer AUSSI
// le bulletin de la période précédente à chaque ouverture (coût doublé),
// non implémenté ici faute d'arbitrage explicite sur son utilité à ce coût.
// ===========================================================================
type CategorieRubrique = "gains" | "cotisations" | "retenues" | "elements";

const LIBELLES_CATEGORIE: Record<CategorieRubrique, string> = {
  gains: "Gains",
  cotisations: "Cotisations",
  retenues: "Retenues",
  elements: "Éléments & bases",
};

function categoriserLignes(lignes: LigneBulletin[]): Record<CategorieRubrique, LigneBulletin[]> {
  const cotisations = lignes.filter((l) => l.est_cotisation);
  const reste = lignes.filter((l) => !l.est_cotisation);
  return {
    gains: reste.filter((l) => l.sens === "GAIN"),
    cotisations,
    retenues: reste.filter((l) => l.sens === "RETENUE"),
    elements: reste.filter((l) => l.sens === "NEUTRE"),
  };
}

function TableauRubriquesBulletin({ lignes, titre }: { lignes: LigneBulletin[]; titre: string }) {
  const fmt = (v: string | null | undefined) => (v == null || v === "" ? "—" : parseFloat(v).toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const categories = categoriserLignes(lignes);
  const [afficherCumuls, setAfficherCumuls] = useState(false);

  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{titre}</div>
        <button
          onClick={() => setAfficherCumuls((v) => !v)}
          className={`text-xs rounded-full border px-2 py-0.5 transition-colors ${afficherCumuls ? "border-primary bg-primary/10 text-primary font-medium" : "border-border text-muted-foreground hover:text-foreground"}`}
        >
          Cumuls {afficherCumuls ? "✓" : ""}
        </button>
      </div>
      <Table className="text-sm">
        <TableHeader>
          <TableRow>
            <TableHead>Rubrique</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Base</TableHead>
            <TableHead className="text-right">Nb</TableHead>
            <TableHead className="text-right">Taux</TableHead>
            <TableHead className="text-right">Montant</TableHead>
            {afficherCumuls && (
              <>
                <TableHead className="text-right">Nb cumul</TableHead>
                <TableHead className="text-right">Montant cumul</TableHead>
              </>
            )}
            <TableHead className="text-right">Part patr.</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Observation</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(Object.keys(categories) as CategorieRubrique[]).map((cat) => {
            const lignesCat = categories[cat];
            if (lignesCat.length === 0) return null;
            const sousTotal = lignesCat.reduce((s, l) => s + parseFloat(l.montant || "0"), 0);
            return (
              <Fragment key={cat}>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={5} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {LIBELLES_CATEGORIE[cat]} ({lignesCat.length})
                  </TableCell>
                  <TableCell className="text-right text-xs font-semibold tabular-nums" colSpan={afficherCumuls ? 6 : 4}>{fmt(String(sousTotal))}</TableCell>
                </TableRow>
                {lignesCat.map((l) => (
                  <TableRow key={l.code_rubrique}>
                    <TableCell>
                      <div className="font-medium">{l.libelle}</div>
                      <div className="font-mono text-xs text-muted-foreground">{l.code_rubrique}</div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.type_periodicite ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(l.base)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(l.nombre)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(l.taux)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{fmt(l.montant)}</TableCell>
                    {afficherCumuls && (
                      <>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(l.nombre_cumul)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium text-foreground">{fmt(l.montant_cumul)}</TableCell>
                      </>
                    )}
                    <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(l.montant_patronal)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{l.date_valeur ?? "—"}</TableCell>
                    <TableCell className="text-xs max-w-[160px] truncate" style={{ color: l.observation ? "hsl(var(--warning, 38 92% 40%))" : undefined }} title={l.observation ?? l.texte ?? undefined}>
                      {l.observation ?? l.texte ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function DetailBulletinModal({ bulletinId, scenarios, onFermer }: { bulletinId: string; scenarios: { id: string; nom: string }[]; onFermer: () => void }) {
  const [detail, setDetail] = useState<BulletinSimuleDetail | null>(null);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    setChargement(true);
    lireBulletinPopulation(bulletinId).then(setDetail).catch(() => setDetail(null)).finally(() => setChargement(false));
  }, [bulletinId]);

  const fmt = (v: string | null | undefined) => (v == null ? "—" : parseFloat(v).toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const totauxAffiches = detail?.totaux_apres_fusion ?? detail?.totaux_avant ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onFermer}>
      <div className="w-full max-w-[95vw] max-h-[90vh] overflow-y-auto rounded-lg border bg-background shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <div className="font-semibold flex items-center gap-2">
              {detail ? `${detail.nom} ${detail.prenom}` : "Chargement…"}
              {detail && <span className="font-mono text-xs text-muted-foreground">{detail.matricule}</span>}
            </div>
            {detail && (
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-muted-foreground">{MOIS_COURT[detail.periode_mois]}/{detail.periode_annee}</span>
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">Simulation</span>
                {detail.unite_libelle && <span className="text-xs text-muted-foreground">· {detail.unite_libelle}</span>}
              </div>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onFermer}><X className="h-4 w-4" /></Button>
        </div>

        {chargement ? (
          <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !detail ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Bulletin introuvable.</p>
        ) : (
          <div className="p-4 space-y-4">
            {totauxAffiches && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Net à payer</div>
                  <div className="text-lg font-semibold tabular-nums">{fmt(totauxAffiches.net_a_payer)}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Total gains</div>
                  <div className="text-lg font-semibold tabular-nums">{fmt(totauxAffiches.total_gains)}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Total retenues</div>
                  <div className="text-lg font-semibold tabular-nums">{fmt(totauxAffiches.total_retenues)}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Coût employeur</div>
                  <div className="text-lg font-semibold tabular-nums">{fmt(totauxAffiches.cout_employeur)}</div>
                </div>
              </div>
            )}

            {detail.par_scenario && detail.par_scenario.length > 0 && (
              <div className="rounded-md border">
                <div className="px-3 pt-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Par scénario (cette période)</div>
                <Table className="text-sm">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Scénario</TableHead>
                      <TableHead className="text-right">Net après</TableHead>
                      <TableHead className="text-right">Écart</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.par_scenario.map((ps) => (
                      <TableRow key={ps.scenario_id}>
                        <TableCell>{ps.scenario_nom}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(ps.net_apres)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(ps.ecart_net)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className={`grid gap-4 ${detail.lignes_apres_fusion ? "xl:grid-cols-2" : ""}`}>
              {detail.lignes_avant && <TableauRubriquesBulletin lignes={detail.lignes_avant} titre="Rubriques — tel quel" />}
              {detail.lignes_apres_fusion && <TableauRubriquesBulletin lignes={detail.lignes_apres_fusion} titre="Rubriques — avec scénarios (fusion)" />}
            </div>

            {totauxAffiches && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border p-3 sm:grid-cols-3">
                <div><span className="text-xs text-muted-foreground">Brut imposable : </span><span className="font-medium tabular-nums">{fmt(totauxAffiches.total_brut_imposable)}</span></div>
                <div><span className="text-xs text-muted-foreground">Cotisations salariales : </span><span className="font-medium tabular-nums">{fmt(totauxAffiches.total_cot_salariale)}</span></div>
                <div><span className="text-xs text-muted-foreground">Net imposable : </span><span className="font-medium tabular-nums">{fmt(totauxAffiches.net_imposable)}</span></div>
                <div><span className="text-xs text-muted-foreground">Total retenues : </span><span className="font-medium tabular-nums">{fmt(totauxAffiches.total_retenues)}</span></div>
                <div><span className="text-xs text-muted-foreground">Cotisations patronales : </span><span className="font-medium tabular-nums">{fmt(totauxAffiches.total_cot_patronale)}</span></div>
                <div className="font-semibold"><span className="text-xs text-muted-foreground font-normal">Net à payer : </span><span className="tabular-nums">{fmt(totauxAffiches.net_a_payer)}</span></div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
