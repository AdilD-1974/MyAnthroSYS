/**
 * src/pages/paie/simulation/ConsultationSimulationsPage.tsx
 * Route : /paie/traitement/simulation-population/historique
 *
 * Consultation des lancements de simulation par population déjà enregistrés
 * (RG-SIM-POPULATION-06, proposition — Adil DAIA : "écrans de consultation
 * des simulations", "hyper ingénieux... du global au détail le plus fin").
 *
 * 3 niveaux de lecture, en un seul écran à onglets :
 *   • LISTE       — tous les lancements enregistrés (le "global" : toute
 *                   l'entreprise sur une période donnée), avec purge.
 *   • DÉTAIL      — reprend TELS QUELS les composants déjà construits sur
 *                   l'écran de lancement (ResultatPopulationVue,
 *                   ListeBulletinsSimules — importés, jamais dupliqués),
 *                   enrichi d'un graphique d'évolution période par période
 *                   ("détail le plus fin" au clic sur un bulletin, hérité).
 *   • COMPARAISON — plusieurs lancements sélectionnés, côte à côte.
 *
 * Aucun nouvel endpoint backend nécessaire — tout repose sur les endpoints
 * déjà livrés (liste/détail/regroupements/export/purge des jobs).
 */
import { useEffect, useState } from "react";
import { ArrowLeft, Eye, FileDown, Loader2, Scale, Search, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableHeader, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  listerJobsPopulation,
  lireJobPopulation,
  purgerJobPopulation,
  telechargerExportPopulationComplet,
  listerBulletinsPopulation,
  type SimulationPopulationJobResume,
  type SimulationPopulationJobStatut,
  type GroupeBulletinsPopulation,
} from "@/lib/simulation-api";
import { ResultatPopulationVue } from "@/pages/paie/simulation/SimulationPopulationPage";

const LIBELLES_STATUT: Record<string, { label: string; classe: string }> = {
  EN_ATTENTE: { label: "En attente", classe: "bg-muted text-muted-foreground" },
  EN_COURS: { label: "En cours", classe: "bg-accent/20 text-accent-foreground" },
  TERMINE: { label: "Terminé", classe: "bg-primary/12 text-primary" },
  ERREUR: { label: "Erreur", classe: "bg-destructive/12 text-destructive" },
};

type Vue = "liste" | "detail" | "comparaison";

export default function ConsultationSimulationsPage() {
  const [vue, setVue] = useState<Vue>("liste");
  const [jobs, setJobs] = useState<SimulationPopulationJobResume[]>([]);
  const [chargement, setChargement] = useState(true);
  const [recherche, setRecherche] = useState("");
  const [filtreStatut, setFiltreStatut] = useState<string>("TOUS");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [jobOuvertId, setJobOuvertId] = useState<string | null>(null);
  const [vueOrigine, setVueOrigine] = useState<Vue>("liste");
  const [erreurListe, setErreurListe] = useState<string | null>(null);

  function charger() {
    setChargement(true);
    setErreurListe(null);
    listerJobsPopulation(filtreStatut === "TOUS" ? undefined : filtreStatut)
      .then(setJobs)
      .catch((e) => {
        setJobs([]);
        setErreurListe(e instanceof Error ? e.message : "Erreur de chargement de l'historique");
      })
      .finally(() => setChargement(false));
  }

  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtreStatut]);

  const jobsFiltres = jobs.filter((j) =>
    recherche.trim() ? j.population_nom.toLowerCase().includes(recherche.trim().toLowerCase()) : true
  );

  function basculerSelection(id: string) {
    setSelection((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function purger(id: string) {
    if (!window.confirm("Purger ce lancement ? Tous ses bulletins simulés seront définitivement supprimés.")) return;
    await purgerJobPopulation(id);
    setSelection((s) => { const n = new Set(s); n.delete(id); return n; });
    charger();
  }

  /**
   * Export groupé — un fichier .xlsx par lancement (le navigateur télécharge
   * plusieurs fichiers). Déclenchements espacés de 400ms : la plupart des
   * navigateurs bloquent/avertissent sur des téléchargements multiples
   * strictement simultanés déclenchés par script.
   */
  async function exporterSelection(jobsAExporter: SimulationPopulationJobResume[]) {
    if (jobsAExporter.length === 0) {
      window.alert("Aucun lancement terminé dans la sélection à exporter.");
      return;
    }
    const echecs: string[] = [];
    for (const j of jobsAExporter) {
      try {
        await telechargerExportPopulationComplet(j.id, j.population_nom);
      } catch (e) {
        echecs.push(`${j.population_nom} (${j.id.slice(0, 8)}…) : ${e instanceof Error ? e.message : "erreur inconnue"}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    if (echecs.length > 0) {
      window.alert(`${echecs.length} export(s) ont échoué :\n${echecs.join("\n")}`);
    }
  }

  function voir(id: string, depuis: Vue = "liste") {
    setVueOrigine(depuis);
    setJobOuvertId(id);
    setVue("detail");
  }

  return (
    <div className="p-6 space-y-6 w-full">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Scale className="h-6 w-6 text-primary" /> Consultation des simulations
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Historique des lancements par population — du global (toute l'entreprise sur une période) au détail
            le plus fin (une rubrique, sur un bulletin, pour une personne).
          </p>
        </div>
        {vue !== "liste" && (
          <Button
            variant="outline"
            onClick={() => {
              const cible = vue === "detail" ? vueOrigine : "liste";
              setVue(cible);
              if (cible === "liste") setJobOuvertId(null);
            }}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> {vue === "detail" && vueOrigine === "comparaison" ? "Retour à la comparaison" : "Retour à la liste"}
          </Button>
        )}
      </div>

      {vue === "liste" && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Rechercher une population…" value={recherche} onChange={(e) => setRecherche(e.target.value)} className="pl-8" />
            </div>
            <div className="inline-flex rounded-md border bg-card p-0.5 text-sm">
              {(["TOUS", "TERMINE", "EN_COURS", "EN_ATTENTE", "ERREUR"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setFiltreStatut(s)}
                  className={`px-2.5 py-1.5 rounded-md transition-colors ${
                    filtreStatut === s ? "bg-primary text-primary-foreground font-medium shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  }`}
                >
                  {s === "TOUS" ? "Tous" : LIBELLES_STATUT[s]?.label ?? s}
                </button>
              ))}
            </div>
            {selection.size >= 1 && (
              <>
                <Button
                  variant="outline" size="sm"
                  onClick={() => exporterSelection([...selection].map((id) => jobs.find((j) => j.id === id)).filter((j): j is SimulationPopulationJobResume => !!j && j.statut === "TERMINE"))}
                >
                  <FileDown className="mr-2 h-4 w-4" /> Exporter ({selection.size})
                </Button>
                <Button
                  variant="outline" size="sm"
                  onClick={async () => {
                    if (!window.confirm(`Purger ${selection.size} lancement(s) ? Tous leurs bulletins simulés seront définitivement supprimés.`)) return;
                    await Promise.all([...selection].map((id) => purgerJobPopulation(id)));
                    setSelection(new Set());
                    charger();
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4 text-destructive" /> Purger ({selection.size})
                </Button>
              </>
            )}
            {selection.size >= 2 && (
              <Button size="sm" onClick={() => setVue("comparaison")}>
                <Scale className="mr-2 h-4 w-4" /> Comparer ({selection.size})
              </Button>
            )}
          </div>

          <div className="rounded-md border">
            <Table className="text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    {jobsFiltres.length > 0 && (
                      <input
                        type="checkbox"
                        title="Tout sélectionner"
                        checked={jobsFiltres.every((j) => selection.has(j.id))}
                        ref={(el) => {
                          if (el) el.indeterminate = jobsFiltres.some((j) => selection.has(j.id)) && !jobsFiltres.every((j) => selection.has(j.id));
                        }}
                        onChange={(e) => {
                          setSelection((s) => {
                            const n = new Set(s);
                            if (e.target.checked) jobsFiltres.forEach((j) => n.add(j.id));
                            else jobsFiltres.forEach((j) => n.delete(j.id));
                            return n;
                          });
                        }}
                        className="h-4 w-4"
                      />
                    )}
                  </TableHead>
                  <TableHead>Population</TableHead>
                  <TableHead>Plage</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Collaborateurs</TableHead>
                  <TableHead>Lancé par</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chargement ? (
                  <TableRow><TableCell colSpan={8} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></TableCell></TableRow>
                ) : jobsFiltres.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-sm">
                      {erreurListe ? (
                        <span className="text-destructive">{erreurListe}</span>
                      ) : (
                        <span className="text-muted-foreground">Aucun lancement.</span>
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  jobsFiltres.map((j) => {
                    const plage = j.periode_debut_libelle === j.periode_fin_libelle
                      ? j.periode_debut_libelle
                      : `${j.periode_debut_libelle ?? "—"} → ${j.periode_fin_libelle ?? "—"}`;
                    const st = LIBELLES_STATUT[j.statut] ?? { label: j.statut, classe: "bg-muted" };
                    return (
                      <TableRow key={j.id} className="hover:bg-muted/30">
                        <TableCell>
                          <input type="checkbox" checked={selection.has(j.id)} onChange={() => basculerSelection(j.id)} className="h-4 w-4" />
                        </TableCell>
                        <TableCell className="font-medium">
                          {j.population_nom}
                          {j.scenario_noms.length > 0 ? (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {j.scenario_noms.map((nom) => (
                                <span key={nom} className="rounded-full bg-primary/12 px-1.5 py-0 text-[10px] font-medium text-primary">{nom}</span>
                              ))}
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground italic mt-0.5">Tel quel (aucun scénario)</div>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{plage}</TableCell>
                        <TableCell><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.classe}`}>{st.label}</span></TableCell>
                        <TableCell className="text-right tabular-nums">
                          {j.statut === "EN_COURS" ? `${j.nb_traites} / ${j.nb_total}` : j.nb_total}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{j.created_by_nom}</TableCell>
                        <TableCell className="text-muted-foreground tabular-nums">
                          {new Date(j.created_at).toLocaleString("fr-MA", { dateStyle: "short", timeStyle: "short" })}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Voir" onClick={() => voir(j.id)} disabled={j.statut !== "TERMINE"}>
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost" size="icon" className="h-8 w-8" title="Exporter Excel (7 onglets)"
                              onClick={() => telechargerExportPopulationComplet(j.id, j.population_nom).catch((e) => window.alert(e instanceof Error ? e.message : "Erreur d'export"))}
                              disabled={j.statut !== "TERMINE"}
                            >
                              <FileDown className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Purger" onClick={() => purger(j.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {vue === "detail" && jobOuvertId && <VueDetailJob jobId={jobOuvertId} />}

      {vue === "comparaison" && <VueComparaison jobIds={[...selection]} onVoir={(id) => voir(id, "comparaison")} />}
    </div>
  );
}

// ===========================================================================
// Vue détail — reprend TELS QUELS les composants de l'écran de lancement
// (ResultatPopulationVue, ListeBulletinsSimules), enrichis d'un graphique
// d'évolution période par période (aucune dépendance externe — SVG inline).
// ===========================================================================
function VueDetailJob({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<SimulationPopulationJobStatut | null>(null);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    setChargement(true);
    lireJobPopulation(jobId).then(setJob).catch(() => setJob(null)).finally(() => setChargement(false));
  }, [jobId]);

  if (chargement) return <div className="py-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!job?.resultat) return <p className="py-12 text-center text-sm text-muted-foreground">Lancement introuvable ou non terminé.</p>;

  return (
    <div className="space-y-6">
      <ResultatPopulationVue
        jobId={jobId}
        resultat={job.resultat}
        onExporter={() => telechargerExportPopulationComplet(jobId, job.resultat!.population_nom)}
      />
      {job.resultat.nb_periodes > 1 && <GraphiqueEvolution jobId={jobId} />}
    </div>
  );
}

/**
 * Évolution période par période — SVG inline, aucune bibliothèque de
 * graphique externe (cohérent avec le reste de l'app, jamais de dépendance
 * non confirmée). Données : GET .../bulletins?groupby=periode, déjà
 * agrégées côté SQL (pas de recalcul ici).
 */
function GraphiqueEvolution({ jobId }: { jobId: string }) {
  const [groupes, setGroupes] = useState<GroupeBulletinsPopulation[] | null>(null);

  useEffect(() => {
    listerBulletinsPopulation(jobId, "periode")
      .then((res) => setGroupes(res.groupes ?? []))
      .catch(() => setGroupes([]));
  }, [jobId]);

  if (!groupes) return <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (groupes.length < 2) return null;

  const valeurs = groupes.map((g) => parseFloat(g.net_apres_fusion));
  const max = Math.max(...valeurs, 1);
  const min = Math.min(...valeurs, 0);
  const marge = (max - min) * 0.1 || 1;
  const yMax = max + marge, yMin = min - marge;
  const largeur = 900, hauteur = 220, padGauche = 70, padBas = 30, padHaut = 10;
  const largeurGraphe = largeur - padGauche - 10;
  const hauteurGraphe = hauteur - padBas - padHaut;

  const points = groupes.map((g, i) => {
    const x = padGauche + (groupes.length === 1 ? largeurGraphe / 2 : (i / (groupes.length - 1)) * largeurGraphe);
    const v = parseFloat(g.net_apres_fusion);
    const y = padHaut + (1 - (v - yMin) / (yMax - yMin)) * hauteurGraphe;
    return { x, y, g, valeur: v };
  });
  const chemin = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  // Étiquettes d'axe X dynamiques — avec 30+ périodes, afficher TOUTES les
  // étiquettes les fait toutes se chevaucher (illisible). Un maximum
  // raisonnable de libellés visibles est fixé, espacés régulièrement,
  // TOUJOURS avec le premier et le dernier point inclus pour donner le
  // cadre temporel — les points intermédiaires non étiquetés restent
  // visibles (le trait/point) et consultables au survol (info-bulle SVG
  // native, sans dépendance externe).
  const MAX_ETIQUETTES = 10;
  const pasEtiquette = Math.max(1, Math.ceil(groupes.length / MAX_ETIQUETTES));
  const rayonPoint = groupes.length > 20 ? 2 : groupes.length > 10 ? 2.5 : 3;

  const dernierEcart = parseFloat(groupes[groupes.length - 1].ecart_net_fusion);
  const premierEcart = parseFloat(groupes[0].ecart_net_fusion);
  const tendanceHausse = dernierEcart >= premierEcart;

  return (
    <div className="rounded-md border p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
        {tendanceHausse ? <TrendingUp className="h-3.5 w-3.5 text-primary" /> : <TrendingDown className="h-3.5 w-3.5 text-destructive" />}
        Évolution — net à payer total (fusion), période par période
        {groupes.length > MAX_ETIQUETTES && (
          <span className="font-normal normal-case text-muted-foreground/70">— {groupes.length} périodes, survoler un point pour le détail</span>
        )}
      </div>
      <svg viewBox={`0 0 ${largeur} ${hauteur}`} className="w-full h-auto">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padHaut + t * hauteurGraphe;
          const val = yMax - t * (yMax - yMin);
          return (
            <g key={t}>
              <line x1={padGauche} y1={y} x2={largeur - 10} y2={y} stroke="hsl(var(--border, 220 13% 91%))" strokeWidth="1" />
              <text x={padGauche - 8} y={y + 3} textAnchor="end" fontSize="9" fill="currentColor" className="text-muted-foreground">
                {val.toLocaleString("fr-MA", { maximumFractionDigits: 0 })}
              </text>
            </g>
          );
        })}
        <path d={chemin} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" />
        {points.map((p, i) => {
          const dernierIndex = points.length - 1;
          const etiquetteVisible = i % pasEtiquette === 0 || i === dernierIndex;
          return (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={rayonPoint} fill="hsl(var(--primary))">
                <title>{p.g.cle} — {p.valeur.toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</title>
              </circle>
              {etiquetteVisible && (
                <text x={p.x} y={hauteur - 8} textAnchor="middle" fontSize="9" fill="currentColor" className="text-muted-foreground">
                  {p.g.cle}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ===========================================================================
// Vue comparaison — plusieurs lancements côte à côte.
// ===========================================================================
function VueComparaison({ jobIds, onVoir }: { jobIds: string[]; onVoir: (id: string) => void }) {
  const [jobs, setJobs] = useState<SimulationPopulationJobStatut[]>([]);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    setChargement(true);
    Promise.all(jobIds.map((id) => lireJobPopulation(id)))
      .then((res) => setJobs(res.filter((j) => j.resultat)))
      .catch(() => setJobs([]))
      .finally(() => setChargement(false));
  }, [jobIds]);

  const fmt = (v: string | null) => (v == null ? "—" : parseFloat(v).toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const ecartCouleur = (v: string | null) => {
    if (v == null) return undefined;
    const n = parseFloat(v);
    return n === 0 ? undefined : n > 0 ? "hsl(var(--success, 142 71% 35%))" : "hsl(var(--destructive))";
  };

  if (chargement) return <div className="py-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (jobs.length === 0) return <p className="py-12 text-center text-sm text-muted-foreground">Aucun lancement exploitable dans la sélection.</p>;

  // Palette du thème (--primary/--secondary/--accent) — un lancement, une
  // couleur, cohérente sur tous les graphiques de cet écran.
  const PALETTE = ["hsl(var(--primary))", "hsl(var(--secondary))", "hsl(var(--accent))", "hsl(var(--destructive))"];
  const couleur = (i: number) => PALETTE[i % PALETTE.length];

  const lignes: { label: string; valeurs: (job: SimulationPopulationJobStatut) => string | null; ecart?: boolean }[] = [
    { label: "Collaborateurs", valeurs: (j) => String(j.resultat!.nb_collaborateurs) },
    { label: "Erreurs", valeurs: (j) => String(j.resultat!.nb_erreurs) },
    { label: "Périodes cumulées", valeurs: (j) => String(j.resultat!.nb_periodes) },
    { label: "Net à payer — après (fusion)", valeurs: (j) => j.resultat!.resume_fusion.net_apres },
    { label: "Coût employeur — masse salariale (après)", valeurs: (j) => j.resultat!.resume_fusion.cout_employeur_apres },
    { label: "Net avant", valeurs: (j) => j.resultat!.resume_fusion.net_avant },
    { label: "Écart net", valeurs: (j) => j.resultat!.resume_fusion.ecart_net, ecart: true },
    { label: "Coût employeur avant", valeurs: (j) => j.resultat!.resume_fusion.cout_employeur_avant },
    { label: "Écart coût employeur", valeurs: (j) => j.resultat!.resume_fusion.ecart_cout_employeur, ecart: true },
  ];

  return (
    <div className="space-y-6">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Comparaison de {jobs.length} lancement{jobs.length > 1 ? "s" : ""}
      </div>

      {jobs.some((j) => j.resultat!.resume_fusion.ecart_net == null) && (
        <div className="rounded-md border border-muted-foreground/20 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Au moins un des lancements comparés a été lancé avec « Calculer les écarts » décoché — seules les valeurs
          « après » (net à payer, masse salariale) sont disponibles pour lui ; les écarts et les valeurs "avant"
          affichent « — ».
        </div>
      )}

      {/* Cartes d'en-tête — un lancement, une couleur, avec ses scénarios
          (sans ça, deux lancements sur "Toutes les populations" à la même
          plage sont indiscernables l'un de l'autre). */}
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(jobs.length, 4)}, minmax(0, 1fr))` }}>
        {jobs.map((j, i) => {
          const r = j.resultat!;
          const plage = r.periode_debut_libelle === r.periode_fin_libelle ? r.periode_debut_libelle : `${r.periode_debut_libelle} → ${r.periode_fin_libelle}`;
          return (
            <button
              key={j.id}
              onClick={() => onVoir(j.id)}
              className="text-left rounded-md border p-3 space-y-2 hover:shadow-md hover:border-primary/40 transition-shadow cursor-pointer"
              style={{ borderTopColor: couleur(i), borderTopWidth: 3 }}
              title="Voir le détail de ce lancement"
            >
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: couleur(i) }} />
                <span className="font-medium text-sm truncate">{r.population_nom}</span>
              </div>
              <div className="text-xs text-muted-foreground">{plage}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(j.created_at).toLocaleString("fr-MA", { dateStyle: "short", timeStyle: "short" })}
              </div>
              <div className="flex flex-wrap gap-1 pt-1">
                {r.scenarios.length === 0 ? (
                  <span className="text-xs text-muted-foreground italic">Aucun scénario (tel quel)</span>
                ) : (
                  r.scenarios.map((s) => (
                    <span key={s.id} className="rounded-full bg-primary/12 px-2 py-0.5 text-xs font-medium text-primary">{s.nom}</span>
                  ))
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Graphiques comparatifs. Priorité aux valeurs "après" (masse
          salariale) — TOUJOURS disponibles, contrairement aux écarts qui
          peuvent être absents (lancement avec "Calculer les écarts"
          décoché). Une barre par lancement, mêmes couleurs que les cartes
          ci-dessus. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <GraphiqueBarresComparaison
          titre="Net à payer — après (fusion)"
          jobs={jobs}
          valeur={(j) => { const v = j.resultat!.resume_fusion.net_apres; return v == null ? null : parseFloat(v); }}
          couleur={couleur}
        />
        <GraphiqueBarresComparaison
          titre="Coût employeur — masse salariale (après)"
          jobs={jobs}
          valeur={(j) => { const v = j.resultat!.resume_fusion.cout_employeur_apres; return v == null ? null : parseFloat(v); }}
          couleur={couleur}
        />
      </div>

      {jobs.some((j) => j.resultat!.resume_fusion.ecart_net != null) && (
        <div className="grid gap-4 sm:grid-cols-2">
          <GraphiqueBarresComparaison
            titre="Écart net à payer (fusion)"
            jobs={jobs}
            valeur={(j) => { const v = j.resultat!.resume_fusion.ecart_net; return v == null ? null : parseFloat(v); }}
            couleur={couleur}
          />
          <GraphiqueBarresComparaison
            titre="Écart coût employeur (fusion)"
            jobs={jobs}
            valeur={(j) => { const v = j.resultat!.resume_fusion.ecart_cout_employeur; return v == null ? null : parseFloat(v); }}
            couleur={couleur}
          />
        </div>
      )}

      <div className="rounded-md border overflow-x-auto">
        <div className="px-4 pt-3 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Détail chiffré</div>
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <TableHead>Indicateur</TableHead>
              {jobs.map((j, i) => (
                <TableHead key={j.id} className="text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: couleur(i) }} />
                    {j.resultat!.population_nom}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lignes.map((l) => (
              <TableRow key={l.label}>
                <TableCell className="font-medium text-muted-foreground">{l.label}</TableCell>
                {jobs.map((j) => {
                  const v = l.valeurs(j);
                  return (
                    <TableCell key={j.id} className="text-right tabular-nums" style={{ color: l.ecart ? ecartCouleur(v) : undefined }}>
                      {l.label.includes("Collaborateurs") || l.label.includes("Erreurs") || l.label.includes("Périodes") ? v : fmt(v)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * Barres horizontales comparatives — SVG inline, aucune bibliothèque
 * externe (même approche que le graphique d'évolution ci-dessus). Une
 * barre par lancement, couleur alignée sur les cartes d'en-tête.
 */
function GraphiqueBarresComparaison({
  titre, jobs, valeur, couleur,
}: {
  titre: string; jobs: SimulationPopulationJobStatut[]; valeur: (j: SimulationPopulationJobStatut) => number | null; couleur: (i: number) => string;
}) {
  const valeurs = jobs.map(valeur);
  // Un seul lancement sans valeur (ex. écarts non calculés) ne doit JAMAIS
  // casser le graphique entier — Math.max(...,NaN) renvoie NaN pour TOUT le
  // tableau, pas seulement l'entrée concernée. On filtre donc les null
  // avant de calculer l'échelle, et on les rend à part (repère discret,
  // sans barre) plutôt que de les inclure dans le calcul.
  const valeursDisponibles = valeurs.filter((v): v is number => v != null);
  const maxAbs = Math.max(...valeursDisponibles.map((v) => Math.abs(v)), 1);
  const largeur = 900, hauteurLigne = 30, padGauche = 8, padDroit = 90;
  const hauteur = jobs.length * hauteurLigne + 12;
  const largeurDispo = largeur - padGauche - padDroit;
  const centre = padGauche + largeurDispo / 2;

  return (
    <div className="rounded-md border p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">{titre}</div>
      {/* preserveAspectRatio="none" + hauteur fixe en px : la largeur
          s'étire pour remplir la colonne (grille responsive), MAIS la
          hauteur reste liée au nombre de lancements, pas à la largeur
          réelle du conteneur — sinon un conteneur 2x plus large que la
          référence du viewBox double aussi la hauteur, créant un grand
          vide sous des barres fines (constaté à l'écran). */}
      <svg viewBox={`0 0 ${largeur} ${hauteur}`} preserveAspectRatio="none" style={{ width: "100%", height: `${hauteur}px` }}>
        <line x1={centre} y1={0} x2={centre} y2={hauteur} stroke="hsl(var(--border, 220 13% 91%))" strokeWidth="1" />
        {jobs.map((j, i) => {
          const v = valeurs[i];
          const y = i * hauteurLigne + 6;
          if (v == null) {
            return (
              <text key={j.id} x={centre} y={y + (hauteurLigne - 10) / 2 + 4} fontSize="10" textAnchor="middle" fill="hsl(var(--muted-foreground))" className="italic">
                non disponible
              </text>
            );
          }
          const largeurBarre = (Math.abs(v) / maxAbs) * (largeurDispo / 2 - 4);
          const x = v >= 0 ? centre : centre - largeurBarre;
          return (
            <g key={j.id}>
              <rect x={x} y={y} width={Math.max(largeurBarre, 1)} height={hauteurLigne - 10} fill={couleur(i)} rx="2" />
              <text
                x={v >= 0 ? centre + largeurBarre + 6 : centre - largeurBarre - 6}
                y={y + (hauteurLigne - 10) / 2 + 4}
                fontSize="10"
                textAnchor={v >= 0 ? "start" : "end"}
                fill="currentColor"
                className="tabular-nums"
              >
                {v.toLocaleString("fr-MA", { maximumFractionDigits: 0 })}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
