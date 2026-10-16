/**
 * src/pages/paie/simulation/SimulationIndividuellePage.tsx
 * Route : /paie/traitement/simulation
 *
 * Écran à 3 modes : Bulletin (UC1) / Impact (UC2) / Embauche (UC3).
 * Le lancement en masse par population (RG-SIM-POPULATION-01) vit dans un
 * écran séparé, SimulationPopulationPage.tsx — cet écran-ci reste dédié à
 * la simulation INDIVIDUELLE (un collaborateur à la fois), conformément à
 * son nom et à sa route.
 *
 * Reconstruit après lecture de TraitementPaiePage.tsx (2026-08-07) : combobox
 * collaborateur (Command/cmdk), plan de paie auto-résolu (collaborateur_plan_paie,
 * pas de choix manuel), classes Tailwind sémantiques partout (text-muted-foreground,
 * bg-card, border) au lieu de style inline hsl(var(--...)), pas de calc(--font-scale)
 * (TraitementPaiePage ne l'utilise pas non plus).
 */
import { useEffect, useState } from "react";
import { FileText, ArrowRightLeft, UserPlus, Loader2, Save, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { PaveAccordeon } from "@/components/paie/simulation/PaveAccordeon";
import { CollaborateurCombobox, type CollaborateurOption } from "@/components/paie/simulation/CollaborateurCombobox";
import { PeriodePicker } from "@/components/paie/simulation/PeriodePicker";
import { EditeurSurcharges, type LigneSurchargeUI } from "@/components/paie/simulation/EditeurSurcharges";
import { BulletinLignesTable } from "@/components/paie/simulation/BulletinLignesTable";
import { EcartsTable } from "@/components/paie/simulation/EcartsTable";
import {
  simulerBulletin,
  simulerImpact,
  simulerEmbauche,
  creerScenario,
  listerGabarits,
  exporterExcelSimulation,
  type ResultatBulletin,
  type ResultatImpact,
  type SurchargeRubrique,
  type SurchargeTable,
  type SurchargeRegime,
  type GabaritEmbauche,
} from "@/lib/simulation-api";

type Mode = "BULLETIN" | "IMPACT" | "EMBAUCHE";

const MODES: { valeur: Mode; label: string; icone: typeof FileText }[] = [
  { valeur: "BULLETIN", label: "Bulletin", icone: FileText },
  { valeur: "IMPACT", label: "Impact", icone: ArrowRightLeft },
  { valeur: "EMBAUCHE", label: "Embauche", icone: UserPlus },
];

/**
 * Sépare les surcharges par nature et résout les lignes en mode POURCENTAGE
 * (UI uniquement) en un delta AJOUT concret : delta = montant_actuel × % / 100.
 *
 * `montant_actuel` vient d'un calcul « tel quel » (sans aucune surcharge) sur
 * le même collaborateur/période — déclenché ICI, automatiquement, un appel
 * supplémentaire de simulerBulletin() SEULEMENT si au moins une ligne est en
 * pourcentage (aucun coût dans le cas courant sans pourcentage). Pas besoin
 * que l'utilisateur ait cliqué « Calculer tel quel » avant : la référence est
 * toujours fraîche au moment de l'envoi.
 */
async function separerSurcharges(
  lignes: LigneSurchargeUI[],
  collaborateurIdReference: string | undefined,
  periodeId: string | undefined
): Promise<{ surcharges_rubrique: SurchargeRubrique[]; surcharges_table: SurchargeTable[]; surcharges_regime: SurchargeRegime[] }> {
  const lignesRubrique = lignes.filter(
    (l): l is Extract<LigneSurchargeUI, { nature: "rubrique" }> => l.nature === "rubrique" && !!l.code_rubrique
  );
  const aDesPourcentages = lignesRubrique.some((l) => l.mode === "POURCENTAGE");

  let montantsActuels: Record<string, string> = {};
  if (aDesPourcentages) {
    if (!collaborateurIdReference || !periodeId) {
      throw new Error("Une surcharge en pourcentage nécessite un collaborateur et une période sélectionnés.");
    }
    const base = await simulerBulletin({ collaborateur_id: collaborateurIdReference, periode_id: periodeId });
    base.lignes.forEach((l) => { montantsActuels[l.code_rubrique] = l.montant; });
  }

  const surcharges_rubrique: SurchargeRubrique[] = lignesRubrique.map((l) => {
    if (l.mode === "POURCENTAGE") {
      const montantActuel = parseFloat(montantsActuels[l.code_rubrique] ?? "0");
      const pourcentage = parseFloat(String(l.valeur ?? "0")) || 0;
      const delta = (montantActuel * pourcentage) / 100;
      return { code_rubrique: l.code_rubrique, attribut: "MONTANT", valeur: delta.toFixed(2), mode: "AJOUT" };
    }
    return { code_rubrique: l.code_rubrique, attribut: l.attribut, valeur: String(l.valeur), mode: l.mode };
  });

  const surcharges_table: SurchargeTable[] = lignes
    .filter((l): l is Extract<LigneSurchargeUI, { nature: "table" }> => l.nature === "table")
    .map(({ table, colonne, valeur }) => ({ table, colonne, valeur }));

  const surcharges_regime: SurchargeRegime[] = lignes
    .filter((l): l is Extract<LigneSurchargeUI, { nature: "regime" }> => l.nature === "regime" && !!l.code_regle)
    .map(({ code_regle, mode, taux_salarial, taux_patronal, forcer_affectation, valeur_bareme_taux_simulee }) => ({
      code_regle, mode, taux_salarial, taux_patronal, forcer_affectation, valeur_bareme_taux_simulee,
    }));

  return { surcharges_rubrique, surcharges_table, surcharges_regime };
}

export default function SimulationIndividuellePage() {
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>("BULLETIN");

  return (
    <div className="p-6 space-y-6 w-full">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Simulation individuelle</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Calcul à la volée — jamais persisté dans un bulletin réel.
        </p>
      </div>

      {/* Sélecteur de mode */}
      <div className="inline-flex rounded-md border bg-card p-0.5 text-sm" role="tablist">
        {MODES.map(({ valeur, label, icone: Icone }) => (
          <button
            key={valeur}
            role="tab"
            aria-selected={mode === valeur}
            onClick={() => setMode(valeur)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-colors ${
              mode === valeur ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <Icone className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {mode === "BULLETIN" && <ModeBulletinPanel userId={user?.id} />}
      {mode === "IMPACT" && <ModeImpactPanel userId={user?.id} />}
      {mode === "EMBAUCHE" && <ModeEmbauchePanel userId={user?.id} />}
    </div>
  );
}

// ===========================================================================
// Mode Bulletin — UC1
// ===========================================================================
function ModeBulletinPanel({ userId }: { userId?: string }) {
  const [collaborateur, setCollaborateur] = useState<CollaborateurOption | null>(null);
  const [periodeId, setPeriodeId] = useState("");
  const [surcharges, setSurcharges] = useState<LigneSurchargeUI[]>([]);
  const [resultat, setResultat] = useState<ResultatBulletin | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function calculer() {
    if (!collaborateur || !periodeId) {
      setErreur("Collaborateur et période requis.");
      return;
    }
    setEnCours(true);
    setErreur(null);
    try {
      const { surcharges_rubrique, surcharges_table, surcharges_regime } = await separerSurcharges(surcharges, collaborateur.id, periodeId);
      const res = await simulerBulletin({
        collaborateur_id: collaborateur.id,
        periode_id: periodeId,
        surcharges_rubrique,
        surcharges_table,
        surcharges_regime,
      });
      setResultat(res);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur de calcul");
    } finally {
      setEnCours(false);
    }
  }

  async function enregistrerScenario() {
    if (!resultat || !collaborateur) return;
    const nom = window.prompt("Nom du scénario ?");
    if (!nom) return;
    const { surcharges_rubrique, surcharges_table, surcharges_regime } = await separerSurcharges(surcharges, collaborateur.id, periodeId);
    await creerScenario({
      type_simulation: "BULLETIN",
      nom,
      collaborateur_id: collaborateur.id,
      periode_id: periodeId,
      periode_reference: { annee: resultat.periode.annee, mois: resultat.periode.mois, libelle: resultat.periode.libelle },
      hypotheses: { surcharges_rubrique, surcharges_table, surcharges_regime },
      resultat_calcule: resultat as unknown as Record<string, unknown>,
    });
  }

  async function exporterExcel() {
    if (!resultat || !collaborateur) return;
    await exporterExcelSimulation({
      titre: `Simulation_${collaborateur.matricule}_${resultat.periode.libelle}`,
      type_simulation: "BULLETIN",
      resultat: resultat as unknown as Record<string, unknown>,
    });
  }

  const codesSurcharges = surcharges
    .filter((l): l is Extract<LigneSurchargeUI, { nature: "rubrique" }> => l.nature === "rubrique")
    .map((l) => l.code_rubrique);

  return (
    <div className="space-y-6">
      <PaveAccordeon
        sections={[
          {
            valeur: "selection",
            titre: "Sélection",
            contenu: (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Collaborateur</label>
                    <CollaborateurCombobox value={collaborateur} onChange={setCollaborateur} />
                  </div>
                </div>
                {collaborateur && <PeriodePicker collaborateurId={collaborateur.id} periodeId={periodeId} onChange={setPeriodeId} />}
                <Button onClick={calculer} disabled={enCours}>
                  {enCours && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Calculer tel quel
                </Button>
              </div>
            ),
          },
          {
            valeur: "surcharges",
            titre: "Surcharges",
            badge: surcharges.length > 0 ? <Badge>{surcharges.length}</Badge> : undefined,
            contenu: (
              <div className="space-y-3">
                <EditeurSurcharges lignes={surcharges} onChange={setSurcharges} />
                <Button variant="secondary" onClick={calculer} disabled={enCours}>
                  {enCours && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Recalculer avec surcharges
                </Button>
              </div>
            ),
          },
          {
            valeur: "resultat",
            titre: "Résultat",
            contenu: resultat ? (
              <div className="space-y-3">
                <BulletinLignesTable lignes={resultat.lignes} totaux={resultat.totaux} codesSurcharges={codesSurcharges} />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={enregistrerScenario}>
                    <Save className="mr-2 h-4 w-4" /> Enregistrer comme scénario
                  </Button>
                  <Button variant="outline" size="sm" onClick={exporterExcel}>
                    <FileDown className="mr-2 h-4 w-4" /> Exporter Excel
                  </Button>
                </div>
                {resultat.messages.length > 0 && <MessagesEngine messages={resultat.messages} />}
              </div>
            ) : (
              <VideResultat />
            ),
          },
        ]}
        ouvertsParDefaut={["selection", "surcharges", "resultat"]}
      />
      {erreur && <Erreur texte={erreur} />}
    </div>
  );
}

// ===========================================================================
// Mode Impact — UC2
// ===========================================================================
function ModeImpactPanel({ userId }: { userId?: string }) {
  const [collaborateur, setCollaborateur] = useState<CollaborateurOption | null>(null);
  const [periodeId, setPeriodeId] = useState("");
  const [surcharges, setSurcharges] = useState<LigneSurchargeUI[]>([]);
  const [motif, setMotif] = useState("");
  const [resultat, setResultat] = useState<ResultatImpact | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function calculer() {
    if (!collaborateur || !periodeId) {
      setErreur("Collaborateur et période requis.");
      return;
    }
    setEnCours(true);
    setErreur(null);
    try {
      const { surcharges_rubrique, surcharges_table, surcharges_regime } = await separerSurcharges(surcharges, collaborateur.id, periodeId);
      const res = await simulerImpact({ collaborateur_id: collaborateur.id, periode_id: periodeId, surcharges_rubrique, surcharges_table, surcharges_regime });
      setResultat(res);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur de calcul");
    } finally {
      setEnCours(false);
    }
  }

  async function enregistrerScenario() {
    if (!resultat || !collaborateur) return;
    const nom = window.prompt("Nom du scénario ?");
    if (!nom) return;
    const { surcharges_rubrique, surcharges_table, surcharges_regime } = await separerSurcharges(surcharges, collaborateur.id, periodeId);
    await creerScenario({
      type_simulation: "IMPACT",
      nom,
      collaborateur_id: collaborateur.id,
      periode_id: periodeId,
      periode_reference: { annee: resultat.apres.periode.annee, mois: resultat.apres.periode.mois },
      hypotheses: { motif, surcharges_rubrique, surcharges_table, surcharges_regime },
      resultat_calcule: resultat as unknown as Record<string, unknown>,
    });
  }

  async function exporterExcel() {
    if (!resultat || !collaborateur) return;
    await exporterExcelSimulation({
      titre: `Simulation_Impact_${collaborateur.matricule}_${resultat.apres.periode.libelle}`,
      type_simulation: "IMPACT",
      resultat: resultat as unknown as Record<string, unknown>,
    });
  }

  return (
    <div className="space-y-6">
      <PaveAccordeon
        sections={[
          {
            valeur: "selection",
            titre: "Sélection",
            contenu: (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Collaborateur</label>
                    <CollaborateurCombobox value={collaborateur} onChange={setCollaborateur} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Motif (optionnel)</label>
                    {/* Référentiel de motifs encore à trancher (CONCEPTION §2.2/§6.5) — champ libre en attendant */}
                    <Input placeholder="Ex. Promotion" value={motif} onChange={(e) => setMotif(e.target.value)} />
                  </div>
                </div>
                {collaborateur && <PeriodePicker collaborateurId={collaborateur.id} periodeId={periodeId} onChange={setPeriodeId} />}
              </div>
            ),
          },
          {
            valeur: "changements",
            titre: "Changements",
            badge: surcharges.length > 0 ? <Badge>{surcharges.length}</Badge> : undefined,
            contenu: (
              <div className="space-y-3">
                <EditeurSurcharges lignes={surcharges} onChange={setSurcharges} />
                <Button onClick={calculer} disabled={enCours}>
                  {enCours && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Comparer avant / après
                </Button>
              </div>
            ),
          },
          {
            valeur: "comparaison",
            titre: "Comparaison",
            contenu: resultat ? (
              <div className="space-y-3">
                <EcartsTable lignes={resultat.ecarts.lignes} totaux={resultat.ecarts.totaux} />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={enregistrerScenario}>
                    <Save className="mr-2 h-4 w-4" /> Enregistrer comme scénario
                  </Button>
                  <Button variant="outline" size="sm" onClick={exporterExcel}>
                    <FileDown className="mr-2 h-4 w-4" /> Exporter Excel
                  </Button>
                </div>
              </div>
            ) : (
              <VideResultat />
            ),
          },
        ]}
        ouvertsParDefaut={["selection", "changements", "comparaison"]}
      />
      {erreur && <Erreur texte={erreur} />}
    </div>
  );
}

// ===========================================================================
// Mode Embauche — UC3
// ===========================================================================
function ModeEmbauchePanel({ userId }: { userId?: string }) {
  const [gabarits, setGabarits] = useState<GabaritEmbauche[]>([]);
  const [gabaritSelectionne, setGabaritSelectionne] = useState<string>("");
  const [referenceCollaborateur, setReferenceCollaborateur] = useState<CollaborateurOption | null>(null);
  const [periodeId, setPeriodeId] = useState("");
  const [surcharges, setSurcharges] = useState<LigneSurchargeUI[]>([]);
  const [resultat, setResultat] = useState<ResultatBulletin | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    listerGabarits().then(setGabarits).catch(() => setGabarits([]));
  }, []);

  function appliquerGabarit(id: string) {
    setGabaritSelectionne(id);
    setReferenceCollaborateur(null); // le gabarit prime — pas d'identité de collaborateur à afficher
  }

  const gabaritActif = gabarits.find((g) => g.id === gabaritSelectionne) ?? null;
  const referenceId = gabaritActif ? gabaritActif.collaborateur_reference_id : referenceCollaborateur?.id ?? "";
  // Pour la résolution du plan (PeriodePicker) : gabarit → son collaborateur
  // de référence ; sinon le collaborateur choisi en saisie libre.
  const collaborateurPourPeriode = gabaritActif ? gabaritActif.collaborateur_reference_id : referenceCollaborateur?.id;

  async function calculer() {
    if (!referenceId || !periodeId) {
      setErreur("Collaborateur de référence et période requis.");
      return;
    }
    setEnCours(true);
    setErreur(null);
    try {
      const { surcharges_rubrique, surcharges_table, surcharges_regime } = await separerSurcharges(surcharges, referenceId, periodeId);
      const res = await simulerEmbauche({
        collaborateur_reference_id: referenceId,
        periode_id: periodeId,
        surcharges_rubrique,
        surcharges_table,
        surcharges_regime,
      });
      setResultat(res);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur de calcul");
    } finally {
      setEnCours(false);
    }
  }

  async function enregistrerScenario() {
    if (!resultat) return;
    const nom = window.prompt("Nom du scénario ?");
    if (!nom) return;
    const { surcharges_rubrique, surcharges_table, surcharges_regime } = await separerSurcharges(surcharges, referenceId, periodeId);
    await creerScenario({
      type_simulation: "EMBAUCHE",
      nom,
      collaborateur_id: null, // le candidat n'a pas de fiche réelle (RG-SIM-IND-06)
      periode_id: periodeId,
      periode_reference: { annee: resultat.periode.annee, mois: resultat.periode.mois, libelle: resultat.periode.libelle },
      hypotheses: { collaborateur_reference_id: referenceId, surcharges_rubrique, surcharges_table, surcharges_regime },
      resultat_calcule: resultat as unknown as Record<string, unknown>,
    });
  }

  async function exporterExcel() {
    if (!resultat) return;
    await exporterExcelSimulation({
      titre: `Simulation_Embauche_${resultat.periode.libelle}`,
      type_simulation: "EMBAUCHE",
      resultat: resultat as unknown as Record<string, unknown>,
    });
  }

  const codesSurcharges = surcharges
    .filter((l): l is Extract<LigneSurchargeUI, { nature: "rubrique" }> => l.nature === "rubrique")
    .map((l) => l.code_rubrique);

  return (
    <div className="space-y-6">
      <PaveAccordeon
        sections={[
          {
            valeur: "depart",
            titre: "Point de départ",
            contenu: (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Gabarit d'embauche</label>
                    <select
                      className="flex h-10 w-full items-center rounded-md border bg-background px-3 text-sm"
                      value={gabaritSelectionne}
                      onChange={(e) => appliquerGabarit(e.target.value)}
                    >
                      <option value="">— Saisie libre —</option>
                      {gabarits.map((g) => (
                        <option key={g.id} value={g.id}>{g.nom}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Collaborateur de référence (cotisation)</label>
                    {gabaritActif ? (
                      <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">
                        Défini par le gabarit « {gabaritActif.nom} »
                      </div>
                    ) : (
                      <CollaborateurCombobox value={referenceCollaborateur} onChange={setReferenceCollaborateur} />
                    )}
                  </div>
                </div>
                {collaborateurPourPeriode && <PeriodePicker collaborateurId={collaborateurPourPeriode} periodeId={periodeId} onChange={setPeriodeId} />}
              </div>
            ),
          },
          {
            valeur: "profil",
            titre: "Profil proposé",
            badge: surcharges.length > 0 ? <Badge>{surcharges.length}</Badge> : undefined,
            contenu: (
              <div className="space-y-3">
                <EditeurSurcharges lignes={surcharges} onChange={setSurcharges} />
                <Button onClick={calculer} disabled={enCours}>
                  {enCours && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Calculer le bulletin prévisionnel
                </Button>
              </div>
            ),
          },
          {
            valeur: "resultat",
            titre: "Résultat",
            contenu: resultat ? (
              <div className="space-y-3">
                <BulletinLignesTable lignes={resultat.lignes} totaux={resultat.totaux} codesSurcharges={codesSurcharges} />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={enregistrerScenario}>
                    <Save className="mr-2 h-4 w-4" /> Enregistrer comme scénario
                  </Button>
                  <Button variant="outline" size="sm" onClick={exporterExcel}>
                    <FileDown className="mr-2 h-4 w-4" /> Exporter Excel
                  </Button>
                </div>
              </div>
            ) : (
              <VideResultat />
            ),
          },
        ]}
        ouvertsParDefaut={["depart", "profil", "resultat"]}
      />
      {erreur && <Erreur texte={erreur} />}
    </div>
  );
}

// ===========================================================================
// Petits composants partagés
// ===========================================================================
function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
      {children}
    </span>
  );
}

function VideResultat() {
  return (
    <p className="py-6 text-center text-sm text-muted-foreground">
      Aucun calcul lancé pour l'instant.
    </p>
  );
}

function Erreur({ texte }: { texte: string }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
      {texte}
    </div>
  );
}

function MessagesEngine({ messages }: { messages: string[] }) {
  return (
    <details className="rounded-md border p-3 text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none font-medium">{messages.length} avertissement(s) du moteur</summary>
      <ul className="mt-2 list-disc space-y-1 pl-4">
        {messages.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
      </ul>
    </details>
  );
}
