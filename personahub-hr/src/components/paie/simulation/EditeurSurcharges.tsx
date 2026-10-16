/**
 * src/components/paie/simulation/EditeurSurcharges.tsx
 *
 * Tableau triable + éditable des surcharges ponctuelles (RG-SIM-IND-04).
 * Reconstruit avec les composants Table shadcn/ui et classes Tailwind
 * sémantiques (conforme au pattern réel de TraitementPaiePage.tsx — plus de
 * style inline hsl(var(--...)) ni de calc(--font-scale)).
 *
 *  - La cible « Rubrique » est une liste déroulante peuplée par
 *    GET /simulation/rubriques (exclut déjà COT et ASS côté backend).
 *  - La « Valeur » d'un champ de contrat devient une liste déroulante quand
 *    ce champ pointe vers un référentiel (FK réelle détectée par
 *    GET /simulation/referentiel-valeurs) ; sinon saisie libre adaptée au type.
 */
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableHeader, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { EnTeteTriable } from "./EnTeteTriable";
import { useSortableTable } from "@/hooks/useSortableTable";
import {
  listerRubriquesSimulables,
  listerRegimesSimulables,
  valeursReferentielChamp,
  type SurchargeRubrique,
  type SurchargeTable,
  type SurchargeRegime,
  type AttributSurcharge,
  type ModeSurcharge,
  type ModeSurchargeRegime,
  type RubriqueSimulable,
  type RegimeSimulable,
  type ValeurReferentielle,
} from "@/lib/simulation-api";

// Liste fermée des champs de contrat simulables (CONCEPTION_ECRANS_SIMULATION.md
// §2.4) — volontairement courte au MVP, à étendre sur besoin confirmé. Le
// type ("texte"/"date"/"numerique") ne sert que de repli quand le champ n'a
// PAS de référentiel (FK) détecté — sinon la liste déroulante prime toujours.
const CHAMPS_CONTRAT_SIMULABLES: { table: string; colonne: string; label: string; type: "texte" | "date" | "numerique" }[] = [
  { table: "collaborateur_contrats", colonne: "code_temps", label: "Temps de travail / ETP", type: "texte" },
  { table: "collaborateur_contrats", colonne: "code_type_contrat", label: "Type de contrat", type: "texte" },
  { table: "collaborateur_contrats", colonne: "date_debut", label: "Date d'entrée", type: "date" },
  { table: "collaborateur_salaires_fixes", colonne: "salaire_base", label: "Salaire de base", type: "numerique" },
];

// "POURCENTAGE" est un mode UI uniquement — le backend ne connaît que
// AJOUT/FORCAGE (ModeSurcharge). Une ligne en pourcentage est résolue en
// AJOUT (delta = montant actuel × % / 100) juste avant l'envoi à l'API, via
// resoudreSurchargesRubrique() dans la page appelante — voir
// SimulationIndividuellePage.tsx. Toujours appliqué sur MONTANT (pas de
// sens à un "+10%" sur une base ou un taux dans l'usage courant).
export type ModeSurchargeUI = ModeSurcharge | "POURCENTAGE";

type LigneSurchargeUI =
  | ({ nature: "rubrique"; id: string } & Omit<SurchargeRubrique, "mode"> & { mode: ModeSurchargeUI })
  | ({ nature: "table"; id: string } & SurchargeTable)
  | ({ nature: "regime"; id: string } & SurchargeRegime);

interface EditeurSurchargesProps {
  lignes: LigneSurchargeUI[];
  onChange: (lignes: LigneSurchargeUI[]) => void;
}

let compteurId = 0;
function nouvelId() {
  compteurId += 1;
  return `sim-${Date.now()}-${compteurId}`;
}

export function EditeurSurcharges({ lignes, onChange }: EditeurSurchargesProps) {
  const [rubriques, setRubriques] = useState<RubriqueSimulable[]>([]);
  const [regimes, setRegimes] = useState<RegimeSimulable[]>([]);
  const [cacheReferentiels, setCacheReferentiels] = useState<Record<string, ReferentielChampEtat>>({});

  useEffect(() => {
    listerRubriquesSimulables().then(setRubriques).catch(() => setRubriques([]));
    listerRegimesSimulables().then(setRegimes).catch(() => setRegimes([]));
  }, []);

  function chargerReferentiel(table: string, colonne: string) {
    const cle = `${table}.${colonne}`;
    if (cacheReferentiels[cle]) return;
    setCacheReferentiels((prev) => ({ ...prev, [cle]: { chargement: true, aUnReferentiel: false, valeurs: [] } }));
    valeursReferentielChamp(table, colonne)
      .then((res) =>
        setCacheReferentiels((prev) => ({
          ...prev,
          [cle]: { chargement: false, aUnReferentiel: res.a_un_referentiel, valeurs: res.valeurs },
        }))
      )
      .catch(() =>
        setCacheReferentiels((prev) => ({ ...prev, [cle]: { chargement: false, aUnReferentiel: false, valeurs: [] } }))
      );
  }

  const colonnes = {
    nature: { cle: "nature", type: "texte" as const },
    cible: {
      cle: "cible",
      type: "texte" as const,
      accesseur: (l: LigneSurchargeUI) =>
        l.nature === "rubrique" ? l.code_rubrique : l.nature === "regime" ? l.code_regle : `${l.table}.${l.colonne}`,
    },
    valeur: { cle: "valeur", type: "texte" as const },
  };
  const { donneesTriees, tri, basculerTri } = useSortableTable(lignes, colonnes);

  function ajouterLigneRubrique() {
    onChange([
      ...lignes,
      { nature: "rubrique", id: nouvelId(), code_rubrique: "", attribut: "MONTANT", valeur: "", mode: "FORCAGE" },
    ]);
  }

  function ajouterLigneRegime() {
    onChange([
      ...lignes,
      {
        nature: "regime", id: nouvelId(), code_regle: "", mode: "AJOUT",
        taux_salarial: null, taux_patronal: null, forcer_affectation: false,
        valeur_bareme_taux_simulee: null,
      },
    ]);
  }

  function ajouterLigneTable() {
    const premier = CHAMPS_CONTRAT_SIMULABLES[0];
    chargerReferentiel(premier.table, premier.colonne);
    onChange([
      ...lignes,
      { nature: "table", id: nouvelId(), table: premier.table, colonne: premier.colonne, valeur: "" },
    ]);
  }

  function supprimer(id: string) {
    onChange(lignes.filter((l) => l.id !== id));
  }

  function majLigne(id: string, patch: Partial<LigneSurchargeUI>) {
    onChange(lignes.map((l) => (l.id === id ? ({ ...l, ...patch } as LigneSurchargeUI) : l)));
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border">
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <EnTeteTriable label="Nature" cle="nature" triActif={tri} onTrier={basculerTri} />
              <EnTeteTriable label="Cible" cle="cible" triActif={tri} onTrier={basculerTri} />
              <TableHead>Attribut / Colonne</TableHead>
              <EnTeteTriable label="Valeur" cle="valeur" triActif={tri} onTrier={basculerTri} align="right" />
              <TableHead>Sens</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {donneesTriees.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  Aucune surcharge — le calcul « tel quel » utilise les données réelles.
                </TableCell>
              </TableRow>
            )}
            {donneesTriees.map((ligne) => (
              <LigneEditable
                key={ligne.id}
                ligne={ligne}
                rubriques={rubriques}
                regimes={regimes}
                referentiel={ligne.nature === "table" ? cacheReferentiels[`${ligne.table}.${ligne.colonne}`] : undefined}
                onChargerReferentiel={chargerReferentiel}
                onMaj={(patch) => majLigne(ligne.id, patch)}
                onSupprimer={() => supprimer(ligne.id)}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={ajouterLigneRubrique}>
          <Plus className="mr-1 h-4 w-4" /> Surcharge rubrique
        </Button>
        <Button variant="outline" size="sm" onClick={ajouterLigneTable}>
          <Plus className="mr-1 h-4 w-4" /> Champ de contrat
        </Button>
        <Button variant="outline" size="sm" onClick={ajouterLigneRegime}>
          <Plus className="mr-1 h-4 w-4" /> Taux de régime
        </Button>
      </div>
    </div>
  );
}

interface ReferentielChampEtat {
  chargement: boolean;
  aUnReferentiel: boolean;
  valeurs: ValeurReferentielle[];
}

function LigneEditable({
  ligne,
  rubriques,
  regimes,
  referentiel,
  onChargerReferentiel,
  onMaj,
  onSupprimer,
}: {
  ligne: LigneSurchargeUI;
  rubriques: RubriqueSimulable[];
  regimes: RegimeSimulable[];
  referentiel: ReferentielChampEtat | undefined;
  onChargerReferentiel: (table: string, colonne: string) => void;
  onMaj: (patch: Partial<LigneSurchargeUI>) => void;
  onSupprimer: () => void;
}) {
  const champActif = ligne.nature === "table" ? CHAMPS_CONTRAT_SIMULABLES.find((c) => c.table === ligne.table && c.colonne === ligne.colonne) : undefined;

  useEffect(() => {
    if (ligne.nature === "table") onChargerReferentiel(ligne.table, ligne.colonne);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ligne.nature === "table" ? `${ligne.table}.${ligne.colonne}` : null]);

  const rubriquesGroupees = useMemo(() => {
    const groupes = new Map<string, RubriqueSimulable[]>();
    for (const r of rubriques) {
      const cle = r.code_famille ?? "Autres";
      if (!groupes.has(cle)) groupes.set(cle, []);
      groupes.get(cle)!.push(r);
    }
    return groupes;
  }, [rubriques]);

  return (
    <TableRow>
      <TableCell>
        <Select
          value={ligne.nature}
          onValueChange={(v: "rubrique" | "table" | "regime") =>
            onMaj(
              v === "rubrique"
                ? { nature: "rubrique", code_rubrique: "", attribut: "MONTANT", mode: "FORCAGE" }
                : v === "table"
                ? { nature: "table", table: CHAMPS_CONTRAT_SIMULABLES[0].table, colonne: CHAMPS_CONTRAT_SIMULABLES[0].colonne }
                : {
                    nature: "regime", code_regle: "", mode: "AJOUT",
                    taux_salarial: null, taux_patronal: null, forcer_affectation: false,
                    valeur_bareme_taux_simulee: null,
                  }
            )
          }
        >
          <SelectTrigger className="h-8 w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="rubrique">Rubrique</SelectItem>
            <SelectItem value="table">Champ de contrat</SelectItem>
            <SelectItem value="regime">Taux de régime</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>

      <TableCell>
        {ligne.nature === "rubrique" ? (
          <Select value={ligne.code_rubrique} onValueChange={(v) => onMaj({ code_rubrique: v })}>
            <SelectTrigger className="h-8 w-[240px]">
              <SelectValue placeholder="Choisir une rubrique…" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {[...rubriquesGroupees.entries()].map(([famille, items]) => (
                <div key={famille}>
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">{famille}</div>
                  {items.map((r) => (
                    <SelectItem key={r.code} value={r.code}>
                      {r.libelle} <span className="font-mono text-[10px] opacity-60">({r.code})</span>
                    </SelectItem>
                  ))}
                </div>
              ))}
              {rubriques.length === 0 && (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">Chargement…</div>
              )}
            </SelectContent>
          </Select>
        ) : ligne.nature === "regime" ? (
          <div className="space-y-1.5">
            <Select value={ligne.code_regle} onValueChange={(v) => onMaj({ code_regle: v })}>
              <SelectTrigger className="h-8 w-[240px]">
                <SelectValue placeholder="Choisir un régime…" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {regimes.map((r) => (
                  <SelectItem key={r.code} value={r.code}>
                    {r.libelle} {r.code_regime && <span className="font-mono text-[10px] opacity-60">({r.code_regime})</span>}
                  </SelectItem>
                ))}
                {regimes.length === 0 && (
                  <div className="px-2 py-3 text-center text-xs text-muted-foreground">Chargement…</div>
                )}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox
                checked={ligne.forcer_affectation}
                onCheckedChange={(v) => onMaj({ forcer_affectation: v === true })}
              />
              Simuler l'affiliation (collaborateur non affecté)
            </label>
          </div>
        ) : (
          <Select
            value={`${ligne.table}.${ligne.colonne}`}
            onValueChange={(v) => {
              const champ = CHAMPS_CONTRAT_SIMULABLES.find((c) => `${c.table}.${c.colonne}` === v)!;
              onMaj({ table: champ.table, colonne: champ.colonne, valeur: "" });
              onChargerReferentiel(champ.table, champ.colonne);
            }}
          >
            <SelectTrigger className="h-8 w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHAMPS_CONTRAT_SIMULABLES.map((c) => (
                <SelectItem key={`${c.table}.${c.colonne}`} value={`${c.table}.${c.colonne}`}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </TableCell>

      <TableCell>
        {ligne.nature === "rubrique" ? (
          <Select
            value={ligne.attribut}
            onValueChange={(v: AttributSurcharge) => onMaj({ attribut: v })}
            disabled={ligne.mode === "POURCENTAGE"}
          >
            <SelectTrigger className="h-8 w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="BASE">Base</SelectItem>
              <SelectItem value="NOMBRE">Nombre</SelectItem>
              <SelectItem value="TAUX">Taux</SelectItem>
              <SelectItem value="MONTANT">Montant</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>

      <TableCell className="text-right">
        {ligne.nature === "regime" ? (
          <div className="flex items-center justify-end gap-1.5">
            <div className="space-y-0.5">
              <span className="block text-[10px] text-muted-foreground">Salarial</span>
              <Input
                className="h-8 w-20 text-right"
                type="number"
                step="0.01"
                value={ligne.taux_salarial ?? ""}
                onChange={(e) => onMaj({ taux_salarial: e.target.value || null })}
                placeholder="—"
              />
            </div>
            <div className="space-y-0.5">
              <span className="block text-[10px] text-muted-foreground">Patronal</span>
              <Input
                className="h-8 w-20 text-right"
                type="number"
                step="0.01"
                value={ligne.taux_patronal ?? ""}
                onChange={(e) => onMaj({ taux_patronal: e.target.value || null })}
                placeholder="—"
              />
            </div>
          </div>
        ) : ligne.nature === "table" && referentiel?.aUnReferentiel ? (
          <Select value={String(ligne.valeur ?? "")} onValueChange={(v) => onMaj({ valeur: v })}>
            <SelectTrigger className="h-8 w-full">
              <SelectValue placeholder="Choisir…" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {referentiel.valeurs.map((v) => (
                <SelectItem key={v.code} value={v.code}>{v.libelle}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : ligne.nature === "table" && referentiel?.chargement ? (
          <span className="text-xs text-muted-foreground">Chargement…</span>
        ) : ligne.nature === "rubrique" && ligne.mode === "POURCENTAGE" ? (
          <div className="relative">
            <Input
              className="h-8 pr-6 text-right"
              type="number"
              value={String(ligne.valeur ?? "")}
              onChange={(e) => onMaj({ valeur: e.target.value })}
              placeholder="ex. 10 ou -5"
            />
            <span className="pointer-events-none absolute right-2 top-1.5 text-xs text-muted-foreground">%</span>
          </div>
        ) : ligne.nature === "rubrique" ? (
          <Input
            className="h-8 text-right"
            type="text"
            value={String(ligne.valeur ?? "")}
            onChange={(e) => onMaj({ valeur: e.target.value })}
            placeholder="Valeur"
          />
        ) : (
          <Input
            className="h-8 text-right"
            type={champActif?.type === "date" ? "date" : champActif?.type === "numerique" ? "number" : "text"}
            value={String(ligne.valeur ?? "")}
            onChange={(e) => onMaj({ valeur: e.target.value })}
            placeholder="Valeur"
          />
        )}
      </TableCell>

      <TableCell>
        {ligne.nature === "rubrique" ? (
          <Select
            value={ligne.mode}
            onValueChange={(v: ModeSurchargeUI) => onMaj(v === "POURCENTAGE" ? { mode: v, attribut: "MONTANT" } : { mode: v })}
          >
            <SelectTrigger className="h-8 w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="FORCAGE">Remplace</SelectItem>
              <SelectItem value="AJOUT">Ajoute</SelectItem>
              <SelectItem value="POURCENTAGE">Pourcentage</SelectItem>
            </SelectContent>
          </Select>
        ) : ligne.nature === "regime" ? (
          <Select value={ligne.mode} onValueChange={(v: ModeSurchargeRegime) => onMaj({ mode: v })}>
            <SelectTrigger className="h-8 w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="FORCAGE">Remplace</SelectItem>
              <SelectItem value="AJOUT">+points</SelectItem>
              <SelectItem value="POURCENTAGE">+%</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>

      <TableCell>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onSupprimer}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

export type { LigneSurchargeUI };
