/**
 * JournalPaiePage — Journal de paie (module Rapports, Phase 1).
 *
 * Route : /paie/editions
 * Le gestionnaire choisit librement le périmètre :
 *   - Une période / un plan de paie (tous les collaborateurs concernés)
 *   - Un collaborateur sur plusieurs périodes
 *   - Une année complète (avec plan de paie optionnel)
 * puis obtient un aperçu tabulaire, exportable en PDF ou Excel.
 *
 * Sélecteurs Plan/Période/Collaborateur repris des mêmes mécanismes que
 * TraitementPaiePage.tsx (db.list, cascade collaborateur → plan actif →
 * périodes, combobox collaborateur) pour rester cohérent avec le reste du
 * module Paie.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { db } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  rapportsApi,
  type PerimetreJournal,
  type JournalApercuResponse,
  type GrilleApercuResponse,
  type RapportTemplate,
  valeurNumerique,
} from "@/lib/rapportsApi";

// Un modèle "grille" (ex. JOURNAL_GRILLE_STD, configuré dans
// JournalGrilleConfigPage.tsx) a une mise en page positionnée (ligne/
// colonne/fusion) et passe par un moteur de rendu dédié côté backend
// (rapport_grille_engine, endpoints /journal-grille/*) — distinct du
// tableau générique du journal standard (/journal/*). On le détecte par
// convention de code plutôt que par un champ dédié, cohérent avec le
// reste du module.
const estGrille = (t: Pick<RapportTemplate, "code">) => t.code.includes("GRILLE");

// ---- Types locaux (mêmes que TraitementPaiePage.tsx) --------------------
type Collab = { id: string; matricule: string; nom: string; prenom: string };
type Plan = { id: string; code: string; libelle: string };
type Periode = { id: string; annee: number; mois: number; plan_paie_id: string | null; statut: string; numero_periode: number };

const MOIS = ["", "Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
const periodeLabel = (p: Periode) => `${MOIS[p.mois]} ${p.annee}`;

type ModePerimetre = "periode_plan" | "collaborateur" | "annee";

export default function JournalPaiePage() {
  // Templates
  const [templates, setTemplates] = useState<RapportTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>("");

  // Référentiels
  const [refLoading, setRefLoading] = useState(true);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [collabs, setCollabs] = useState<Collab[]>([]);

  const [mode, setMode] = useState<ModePerimetre>("periode_plan");

  // Mode "periode_plan" : plan choisi directement, périodes de ce plan
  const [planId, setPlanId] = useState<string>("");
  const [periodesDuPlan, setPeriodesDuPlan] = useState<Periode[]>([]);
  const [periodeId, setPeriodeId] = useState<string>("");

  // Mode "collaborateur" : combobox + cascade plan actif → périodes
  const [collabId, setCollabId] = useState<string>("");
  const [collabOpen, setCollabOpen] = useState(false);
  const [periodesCollab, setPeriodesCollab] = useState<Periode[]>([]);
  const [periodeDebutId, setPeriodeDebutId] = useState<string>("");
  const [periodeFinId, setPeriodeFinId] = useState<string>("");

  // Mode "annee"
  const [annee, setAnnee] = useState<number>(new Date().getFullYear());
  const [planAnneeId, setPlanAnneeId] = useState<string>("");

  const [apercu, setApercu] = useState<JournalApercuResponse | null>(null);
  const [apercuGrille, setApercuGrille] = useState<GrilleApercuResponse | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const templateSelectionne = templates.find((t) => t.id === templateId);
  const modeleEstGrille = templateSelectionne ? estGrille(templateSelectionne) : false;

  // Chargement des templates + référentiels (plans, collaborateurs)
  useEffect(() => {
    (async () => {
      try {
        const [tpls, pls, cs] = await Promise.all([
          rapportsApi.listerTemplates("JOURNAL"),
          db.list<Plan>("plan_paie", { select: "id,code,libelle", limit: 200 }),
          db.list<Collab>("collaborateurs", { select: "id,matricule,nom,prenom", archive: false, order: "nom", limit: 2000 }),
        ]);
        setTemplates(tpls);
        const parDefaut = tpls.find((t) => t.par_defaut) ?? tpls[0];
        if (parDefaut) setTemplateId(parDefaut.id);
        setPlans(pls);
        cs.sort((a, b) => (a.nom + a.prenom).localeCompare(b.nom + b.prenom));
        setCollabs(cs);
      } catch (e: any) {
        toast.error("Chargement impossible", { description: e.message });
      } finally {
        setRefLoading(false);
      }
    })();
  }, []);

  // Mode periode_plan : à la sélection du plan, charger ses périodes
  useEffect(() => {
    if (mode !== "periode_plan" || !planId) { setPeriodesDuPlan([]); setPeriodeId(""); return; }
    (async () => {
      try {
        const pers = await db.list<Periode>("calendrier_paie", {
          plan_paie_id: planId,
          select: "id,annee,mois,plan_paie_id,statut,numero_periode",
          order: "-annee", limit: 600,
        });
        pers.sort((a, b) => b.annee - a.annee || b.mois - a.mois);
        setPeriodesDuPlan(pers);
        setPeriodeId(pers[0]?.id || "");
      } catch (e: any) {
        toast.error("Chargement des périodes impossible", { description: e.message });
      }
    })();
  }, [mode, planId]);

  // Mode collaborateur : à la sélection, résoudre le plan actif + ses périodes
  // (même cascade que TraitementPaiePage.tsx via collaborateur_plan_paie)
  useEffect(() => {
    if (mode !== "collaborateur" || !collabId) { setPeriodesCollab([]); setPeriodeDebutId(""); setPeriodeFinId(""); return; }
    (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const liens = await db.list<any>("collaborateur_plan_paie", {
          collaborateur_id: collabId, archive: false,
          select: "plan_paie_id,date_debut,date_fin", order: "-date_debut",
        });
        const actif = liens.find((l: any) => l.date_debut <= today && (!l.date_fin || l.date_fin >= today)) || liens[0];
        if (!actif) { toast.warning("Aucun plan de paie actif pour ce collaborateur"); return; }
        const pers = await db.list<Periode>("calendrier_paie", {
          plan_paie_id: actif.plan_paie_id,
          select: "id,annee,mois,plan_paie_id,statut,numero_periode",
          order: "-annee", limit: 600,
        });
        pers.sort((a, b) => a.annee - b.annee || a.mois - b.mois);
        setPeriodesCollab(pers);
        // Par défaut : les 2 dernières périodes disponibles
        setPeriodeDebutId(pers[Math.max(0, pers.length - 2)]?.id || pers[0]?.id || "");
        setPeriodeFinId(pers[pers.length - 1]?.id || "");
      } catch (e: any) {
        toast.error("Résolution du plan impossible", { description: e.message });
      }
    })();
  }, [mode, collabId]);

  const collab = collabs.find((c) => c.id === collabId);

  function construirePerimetre(): PerimetreJournal | null {
    if (mode === "periode_plan") {
      if (!planId || !periodeId) return null;
      return { mode: "periode_plan", plan_paie_id: planId, periode_id: periodeId };
    }
    if (mode === "collaborateur") {
      if (!collabId || !periodeDebutId || !periodeFinId) return null;
      return {
        mode: "collaborateur",
        collaborateur_id: collabId,
        periode_id_debut: periodeDebutId,
        periode_id_fin: periodeFinId,
      };
    }
    return { mode: "annee", annee, plan_paie_id: planAnneeId || undefined };
  }

  async function lancerApercu() {
    const perimetre = construirePerimetre();
    if (!templateId || !perimetre) {
      setErreur("Complétez le périmètre avant de générer l'aperçu.");
      return;
    }
    setErreur(null);
    setChargement(true);
    try {
      if (modeleEstGrille) {
        setApercu(null);
        const resultat = await rapportsApi.apercuGrille(templateId, perimetre);
        setApercuGrille(resultat);
      } else {
        setApercuGrille(null);
        const resultat = await rapportsApi.apercuJournal(templateId, perimetre);
        setApercu(resultat);
      }
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setChargement(false);
    }
  }

  async function exporter(format: "PDF" | "EXCEL") {
    const perimetre = construirePerimetre();
    if (!templateId || !perimetre) return;
    // Pas d'export Excel pour la grille — seul un rendu PDF positionné a
    // un sens pour cette mise en page (voir rapportsApi.genererGrillePdf,
    // qui n'a pas d'équivalent Excel).
    const blob = modeleEstGrille
      ? await rapportsApi.genererGrillePdf(templateId, perimetre)
      : await rapportsApi.genererJournal(templateId, perimetre, format);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = modeleEstGrille ? "journal_grille.pdf" : (format === "PDF" ? "journal_de_paie.pdf" : "journal_de_paie.xlsx");
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 space-y-6 w-full">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Journal de paie</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Choisis librement le périmètre, puis génère un aperçu exportable en PDF ou Excel.
          </p>
        </div>
        <div className="flex gap-4 mt-1">
          <a href="/paie/editions/journaux" className="text-sm text-primary hover:underline">
            Gérer les Journaux (code, libellé) →
          </a>
          <a href="/paie/editions/journal-grille" className="text-sm text-primary hover:underline">
            Configurer le Journal officiel (grille) →
          </a>
          <a href="/paie/editions/bulletins" className="text-sm text-primary hover:underline">
            Configurer les Bulletins de paie →
          </a>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Périmètre</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4 items-end flex-wrap">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Modèle</label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger className="w-64"><SelectValue placeholder="Choisir un modèle" /></SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.libelle}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Périmètre</label>
              <Select value={mode} onValueChange={(v) => setMode(v as ModePerimetre)}>
                <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="periode_plan">Une période / un plan de paie</SelectItem>
                  <SelectItem value="collaborateur">Un collaborateur, plusieurs périodes</SelectItem>
                  <SelectItem value="annee">Une année complète</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {mode === "periode_plan" && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr] max-w-2xl">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Plan de paie</label>
                <Select value={planId} onValueChange={setPlanId} disabled={refLoading}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner…" /></SelectTrigger>
                  <SelectContent>
                    {plans.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.code} · {p.libelle}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Période</label>
                <Select value={periodeId} onValueChange={setPeriodeId} disabled={!planId}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner…" /></SelectTrigger>
                  <SelectContent>
                    {periodesDuPlan.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{periodeLabel(p)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {mode === "collaborateur" && (
            <div className="grid gap-4 md:grid-cols-3 max-w-3xl">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Collaborateur</label>
                <Popover open={collabOpen} onOpenChange={setCollabOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-full justify-between font-normal" disabled={refLoading}>
                      {collab ? `${collab.nom} ${collab.prenom} — ${collab.matricule}` : "Sélectionner…"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command filter={(v, s) => (v.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)}>
                      <CommandInput placeholder="Nom, prénom ou matricule…" />
                      <CommandList>
                        <CommandEmpty>Aucun collaborateur.</CommandEmpty>
                        <CommandGroup>
                          {collabs.map((c) => (
                            <CommandItem
                              key={c.id}
                              value={`${c.nom} ${c.prenom} ${c.matricule}`}
                              onSelect={() => { setCollabId(c.id); setCollabOpen(false); }}
                            >
                              <Check className={`mr-2 h-4 w-4 ${c.id === collabId ? "opacity-100" : "opacity-0"}`} />
                              <span className="flex-1">{c.nom} {c.prenom}</span>
                              <span className="text-xs text-muted-foreground">{c.matricule}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Période début</label>
                <Select value={periodeDebutId} onValueChange={setPeriodeDebutId} disabled={!collabId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {periodesCollab.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{periodeLabel(p)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Période fin</label>
                <Select value={periodeFinId} onValueChange={setPeriodeFinId} disabled={!collabId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {periodesCollab.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{periodeLabel(p)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {mode === "annee" && (
            <div className="flex gap-4 flex-wrap items-end">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Année</label>
                <input
                  type="number"
                  className="flex h-10 w-28 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={annee}
                  onChange={(e) => setAnnee(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Plan de paie (optionnel)</label>
                <Select value={planAnneeId} onValueChange={setPlanAnneeId}>
                  <SelectTrigger className="w-64"><SelectValue placeholder="Tous les plans" /></SelectTrigger>
                  <SelectContent>
                    {plans.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.code} · {p.libelle}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button onClick={lancerApercu} disabled={chargement}>
              {chargement && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Aperçu
            </Button>
            {modeleEstGrille && apercuGrille && apercuGrille.nb_collaborateurs > 0 && (
              <Button variant="outline" onClick={() => exporter("PDF")}>Exporter en PDF</Button>
            )}
            {!modeleEstGrille && apercu && apercu.nb_bulletins > 0 && (
              <>
                <Button variant="outline" onClick={() => exporter("PDF")}>Exporter en PDF</Button>
                <Button variant="outline" onClick={() => exporter("EXCEL")}>Exporter en Excel</Button>
              </>
            )}
          </div>

          {erreur && <p className="text-sm text-destructive">{erreur}</p>}
        </CardContent>
      </Card>

      {chargement && <Skeleton className="h-64 w-full" />}

      {modeleEstGrille && apercuGrille && !chargement && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Aperçu — {apercuGrille.nb_collaborateurs} collaborateur{apercuGrille.nb_collaborateurs > 1 ? "s" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {apercuGrille.nb_collaborateurs === 0
                ? "Aucun bulletin ne correspond à ce périmètre."
                : "La mise en page positionnée (lignes/colonnes/fusions) ne peut être affichée fidèlement qu'en PDF — utilise \"Exporter en PDF\" ci-dessus."}
            </p>
          </CardContent>
        </Card>
      )}

      {!modeleEstGrille && apercu && !chargement && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Aperçu — {apercu.nb_bulletins} bulletin{apercu.nb_bulletins > 1 ? "s" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {apercu.nb_bulletins === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun bulletin ne correspond à ce périmètre.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {apercu.colonnes.map((c) => (
                      <TableHead key={c.libelle}>{c.libelle}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apercu.lignes.map((ligne, i) => (
                    <TableRow key={i}>
                      {apercu.colonnes.map((c) => {
                        const val = ligne.valeurs[c.libelle];
                        const affichage = c.type === "total" ? valeurNumerique(val).toLocaleString("fr-MA") : (val ?? "—");
                        return <TableCell key={c.libelle}>{String(affichage)}</TableCell>;
                      })}
                    </TableRow>
                  ))}
                  {Object.keys(apercu.total_general).length > 0 && (
                    <TableRow className="font-semibold border-t-2">
                      <TableCell colSpan={apercu.colonnes.length - Object.keys(apercu.total_general).length}>
                        Total général
                      </TableCell>
                      {Object.entries(apercu.total_general).map(([k, v]) => (
                        <TableCell key={k}>{v.toLocaleString("fr-MA")}</TableCell>
                      ))}
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
