/**
 * RecuperationModulesPage — Génère des éléments variables à partir des autres
 * modules du SIRH (congés, prêts). Rien n'est écrit avant l'aperçu :
 * on extrait, on contrôle, on affiche, puis on génère sur demande.
 *
 * Depuis la migration 46 : un EV = UNE ligne element_variable, avec une
 * colonne dédiée par grandeur (valeur_base / valeur_nombre / valeur_taux /
 * valeur_montant), plus de colonne attribut/sens. Le signe est porté
 * directement par la valeur numérique. Ex. un prêt avec BASE+NOMBRE+MONTANT
 * sur sa rubrique capital génère UNE seule ligne, pas trois.
 *
 * Sources câblées :
 *   • Congés  : cong_consommation non annulée chevauchant la période → NOMBRE de jours
 *               (rubrique lue sur ref_type_conge.code_rubrique_paie, par type)
 *               ⚠️ cong_consommation, PAS cong_demandes : une ligne de
 *               consommation = une demande complète (1:1 avec demande_id,
 *               jamais scindée par période de paie) ; le recalcul du
 *               chevauchement reste donc nécessaire (voir joursDansPeriode).
 *   • Prêts   : pret_echeances planifiées dans la période        → BASE/NOMBRE/MONTANT×3
 *               (capital, intérêts HT, TVA intérêts — chacun vers sa propre
 *               rubrique sur prets.rubrique_paie_code(_interet/_tva), copiée
 *               du référentiel ref_type_pret à la création du prêt)
 *
 * Les EV créés portent la source du module (POINTAGE / BATCH) et le statut SAISI :
 * ils doivent être validés pour entrer dans le calcul.
 * Auteur : Adil DAIA
 */
import React, { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/api";
import { useFormatMasks } from "@/hooks/useFormatMasks";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, AlertTriangle, CheckCircle2, Download, Play, CalendarDays, Landmark, ListChecks, Trash2, Search } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { useTableSort } from "@/hooks/useTableSort";

type Plan = { id: string; code: string; libelle: string };
type Periode = { id: string; annee: number; mois: number; numero_periode: number; statut: string; date_ouverture: string | null; date_debut: string; date_fin: string; date_reference: string };
type Collab = { id: string; matricule: string; nom: string; prenom: string; statut_collaborateur: string };
type Rubrique = {
  code: string; libelle: string;
  v_ajout: boolean; v_forcage: boolean; v_regularisation: boolean; v_annulation: boolean; v_reprise: boolean;
};

interface ValeurEV {
  code_rubrique: string;
  attribut: string;         // NOMBRE | MONTANT | BASE — détermine la colonne cible (valeur_nombre/valeur_montant/valeur_base)
  libelleAttribut: string;  // pour l'affichage
  source_ev: string;
  valeur: number;           // signée directement (plus de colonne `sens` séparée — migration 46)
  dejaPresent: boolean;
  nonAutorise?: string;     // motif si la rubrique associée ne peut pas recevoir cette valeur
  // RG-EV-SOURCE-TRACABILITE-01 (Adil DAIA) : d'où vient cette valeur, pour
  // pouvoir afficher la période de traitement sur la ligne d'origine
  // (congé/prêt) une fois l'EV généré. `source_ids` est un tableau car un
  // seul EV peut agréger plusieurs lignes sources (ex. deux congés du même
  // type sur la même période, chevauchement RG-CONGE-CHEVAUCHEMENT-02).
  source_table?: "cong_consommation" | "prets";
  source_ids?: string[];
}

interface LigneRecup {
  id: string;           // clé unique d'affichage (distincte de collaborateur_id : un prêt en a besoin d'une propre)
  moduleOrigine: Source;
  collaborateur_id: string;
  matricule: string;
  nom: string;
  detail: string;      // origine (type de congé, n° d'échéance…)
  valeurs: ValeurEV[];
}

type Source = "CONGES" | "PRETS";

const MOIS = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

// ── Calcul de jours de congé — copie fidèle de calcJoursAvecType()
// (DemandeCongeForm.tsx), pour que le décompte recalculé sur une
// sous-période reste rigoureusement cohérent avec celui de la demande
// d'origine (mêmes règles jours ouvrés/ouvrables/fériés/demi-journées).
function isJourFerieRM(date: Date, feriesDates: Set<string>): boolean {
  return feriesDates.has(date.toISOString().split("T")[0]);
}
function isJourOuvreRM(date: Date, typeJour: string): boolean {
  const dow = date.getDay();
  if (typeJour === "OUV2") return dow >= 1 && dow <= 5;   // ouvrables : lun-ven
  return dow !== 0;                                        // ouvrés : lun-sam
}
function calcJoursAvecTypeRM(debut: string, fin: string, debutDemi: string | null, finDemi: string | null, typeJour: string | null, feriesDates: Set<string>): number {
  if (!debut || !fin) return 0;
  const d1 = new Date(debut + "T00:00:00");
  const d2 = new Date(fin + "T00:00:00");
  if (d2 < d1) return 0;
  const tj = typeJour || "CAL";
  if (tj === "CAL") {
    let cal = Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1;
    if (debutDemi === "APRES_MIDI") cal -= 0.5;
    if (finDemi === "MATIN") cal -= 0.5;
    return cal;
  }
  let dec = 0;
  const cursor = new Date(d1);
  while (cursor <= d2) {
    if (isJourOuvreRM(cursor, tj) && !isJourFerieRM(cursor, feriesDates)) dec += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  if (debutDemi === "APRES_MIDI" && isJourOuvreRM(d1, tj) && !isJourFerieRM(d1, feriesDates)) dec -= 0.5;
  if (finDemi === "MATIN" && isJourOuvreRM(d2, tj) && !isJourFerieRM(d2, feriesDates)) dec -= 0.5;
  return Math.max(0, dec);
}
/** Jours décomptés d'une demande qui tombent dans [periode.date_debut, periode.date_fin].
 * Les demi-journées de début/fin ne s'appliquent que si la borne de la
 * sous-période coïncide avec la vraie borne de la demande — une coupure de
 * période n'est pas une demi-journée d'absence.
 *
 * RG-CONGE-PERIODE-FIN-ABSENCE-01 (30/07/2026) : on borne sur
 * `date_fin_absence` (dernier jour RÉEL d'absence), PAS sur `date_retour`
 * (jour de REPRISE du travail, potentiellement bien après le dernier jour
 * d'absence si un week-end/férié s'intercale). Utiliser date_retour ici
 * comptait à tort le jour de reprise comme un jour de congé supplémentaire
 * dès qu'il tombait dans la période analysée — bug corrigé après avoir
 * observé un congé de 5j répercuté en 2j (mai) + 4j (juin) = 6j au lieu de 5.
 * Repli sur date_retour - 1j pour les rares lignes historiques sans
 * date_fin_absence renseignée (avant la migration du 30/07/2026). */
function joursDansPeriode(
  d: { date_debut: string; date_fin_absence?: string | null; date_retour: string; debut_demi_journee: string | null; fin_demi_journee: string | null },
  periode: { date_debut: string; date_fin: string },
  typeJour: string | null, feries: Set<string>,
): number {
  const finAbsenceReelle = d.date_fin_absence || decalerJour(d.date_retour, -1);
  const debutEff = d.date_debut > periode.date_debut ? d.date_debut : periode.date_debut;
  const finEff = finAbsenceReelle < periode.date_fin ? finAbsenceReelle : periode.date_fin;
  if (debutEff > finEff) return 0;
  const debutDemi = debutEff === d.date_debut ? d.debut_demi_journee : null;
  const finDemi = finEff === finAbsenceReelle ? d.fin_demi_journee : null;
  return calcJoursAvecTypeRM(debutEff, finEff, debutDemi, finDemi, typeJour, feries);
}
function decalerJour(dateIso: string, delta: number): string {
  const d = new Date(dateIso + "T00:00:00");
  d.setDate(d.getDate() + delta);
  return d.toISOString().split("T")[0];
}
const actifA = (d1: string | null, d2: string | null, d: string) => (!d1 || d1 <= d) && (!d2 || d2 >= d);
const estSaisissable = (r: Rubrique) => r.v_ajout || r.v_forcage || r.v_regularisation || r.v_annulation || r.v_reprise;

const SOURCES: { code: Source; label: string; desc: string; icone: React.ElementType; attribut: string; source_ev: string }[] = [
  { code: "CONGES", label: "Congés & absences", desc: "Jours de congé approuvés chevauchant la période", icone: CalendarDays, attribut: "NOMBRE", source_ev: "POINTAGE" },
  { code: "PRETS", label: "Échéances de prêts", desc: "Échéances planifiées à prélever sur la période", icone: Landmark, attribut: "MONTANT", source_ev: "BATCH" },
];
const SOURCE_PAR_CODE = new Map(SOURCES.map((s) => [s.code, s]));
// RG-RECUP-LISTER-ELV-01 (Adil DAIA) : correspondance module coché ->
// element_variable.source_table, pour la fonctionnalité "Lister les EV".
const SOURCE_TABLE_PAR_CODE: Record<Source, string> = { CONGES: "cong_consommation", PRETS: "prets" };

interface ElvExistant {
  id: string; collaborateur_id: string; code_rubrique: string; source_table: string | null;
  valeur_base: number | null; valeur_nombre: number | null; valeur_montant: number | null; statut: string;
}

const RecuperationModulesPage: React.FC = () => {
  const { formatDate, formatNumber, formatMoney } = useFormatMasks();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [periodes, setPeriodes] = useState<Periode[]>([]);
  const [rubriques, setRubriques] = useState<Rubrique[]>([]);

  const [planId, setPlanId] = useState("");
  const [periodeId, setPeriodeId] = useState("");
  const [sources, setSources] = useState<Source[]>(["CONGES"]);

  const [lignes, setLignes] = useState<LigneRecup[]>([]);
  const [analyse, setAnalyse] = useState(false);
  const [elvExistants, setElvExistants] = useState<(ElvExistant & { matricule?: string; nom?: string })[] | null>(null);
  const [chargementElv, setChargementElv] = useState(false);
  const [suppressionLot, setSuppressionLot] = useState(false);
  const [validationLot, setValidationLot] = useState(false);
  const [filtreElvTexte, setFiltreElvTexte] = useState("");
  const [filtreElvModule, setFiltreElvModule] = useState<"TOUS" | Source>("TOUS");
  const [filtreElvStatut, setFiltreElvStatut] = useState<"TOUS" | "SAISI" | "VALIDE">("TOUS");
  const [generation, setGeneration] = useState(false);
  const [aAnalyse, setAAnalyse] = useState(false);

  const toggleSource = (code: Source) =>
    setSources((s) => (s.includes(code) ? s.filter((x) => x !== code) : [...s, code]));

  const periodeEstOuverte = (p: Periode) => {
    if (p.statut === "CLOTUREE" || p.statut === "FERMEE") return false;
    if (p.date_ouverture && p.date_ouverture > new Date().toISOString().slice(0, 10)) return false;
    return true;
  };


  useEffect(() => {
    db.list<Plan>("plan_paie", { actif: true, select: "id,code,libelle", order: "code", limit: 200 })
      .then((p) => { setPlans(p); if (p[0]) setPlanId((x) => x || p[0].id); }).catch(() => {});
    db.list<Rubrique>("rubrique_paie", { archive: false, order: "code", limit: 2000,
      select: "code,libelle,v_ajout,v_forcage,v_regularisation,v_annulation,v_reprise" })
      .then((rs) => setRubriques(rs.filter(estSaisissable))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!planId) return;
    db.list<Periode>("calendrier_paie", {
      plan_paie_id: planId, select: "id,annee,mois,numero_periode,statut,date_ouverture,date_debut,date_fin,date_reference", limit: 1000,
    }).then((ps) => {
      ps.sort((a, b) => a.annee - b.annee || a.mois - b.mois || (a.numero_periode || 0) - (b.numero_periode || 0));
      setPeriodes(ps);
      const ouverte = ps.find(periodeEstOuverte);
      setPeriodeId((x) => (x && ps.some((p) => p.id === x) ? x : (ouverte?.id || ps[0]?.id || "")));
    }).catch(() => setPeriodes([]));
  }, [planId]);

  // Réinitialiser l'aperçu si le contexte change
  useEffect(() => { setLignes([]); setAAnalyse(false); }, [planId, periodeId, sources]);

  const periode = periodes.find((p) => p.id === periodeId);
  const periodeOuverte = periode ? periodeEstOuverte(periode) : false;

  // ---------- Extraction (aperçu) ----------
  const analyser = async () => {
    if (!periode) { toast({ title: "Choisissez une période", variant: "destructive" }); return; }
    if (sources.length === 0) { toast({ title: "Cochez au moins un module", variant: "destructive" }); return; }
    setAnalyse(true); setLignes([]);
    try {
      const ref = periode.date_reference;

      // Population : rattachée au plan, active à la date de référence
      const ratt = await db.list<any>("collaborateur_plan_paie", {
        plan_paie_id: planId, archive: false, select: "collaborateur_id,date_debut,date_fin", limit: 10000,
      });
      const idsPlan = new Set(ratt.filter((r) => actifA(r.date_debut, r.date_fin, ref)).map((r) => r.collaborateur_id));
      const collabs = (await db.list<Collab>("collaborateurs", {
        archive: false, select: "id,matricule,nom,prenom,statut_collaborateur", limit: 10000,
      })).filter((c) => idsPlan.has(c.id) && c.statut_collaborateur !== "SORTI");
      const parId = new Map(collabs.map((c) => [c.id, c]));

      // EV déjà présents sur cette période, par (collaborateur, rubrique) —
      // depuis la migration 46, une ligne element_variable porte TOUS les
      // attributs d'un coup (colonnes valeur_base/nombre/taux/montant), donc
      // la présence se vérifie au niveau de la ligne, plus par attribut isolé.
      const dejaLa = new Set(
        (await db.list<any>("element_variable", {
          periode_id: periodeId, select: "collaborateur_id,code_rubrique", limit: 10000,
        })).map((e) => `${e.collaborateur_id}:${e.code_rubrique}`),
      );
      const rubriquesParCode = new Map(rubriques.map((r) => [r.code, r]));

      let res: LigneRecup[] = [];

      if (sources.includes("CONGES")) {
        // RG-CONGE-VARPAIE-01 (Adil DAIA) : la vraie table de consommation de
        // congé est `cong_consommation` (PAS `cong_demandes`) — reliée à
        // `ref_type_conge` directement par le champ texte `code_type_conge`
        // (= ref_type_conge.code), aucune table intermédiaire nécessaire.
        // Vérifié : demande_id est unique dans cong_consommation (1 ligne =
        // 1 demande complète, jamais scindée par période de paie) — le
        // recalcul du chevauchement (RG-CONGE-CHEVAUCHEMENT-02) reste donc
        // nécessaire, contrairement à une table qui serait déjà ventilée.
        // Chaque type de congé porte sa propre rubrique
        // (ref_type_conge.code_rubrique_paie, éditée dans TypeCongesPage.tsx).
        // Un même collaborateur peut cumuler des congés de plusieurs types
        // visant des rubriques différentes dans la même période : on regroupe
        // donc par (collaborateur, rubrique), pas juste par collaborateur.
        const [demandes, typesConge, feries] = await Promise.all([
          db.list<any>("cong_consommation", {
            est_annulee: false, archive: false,
            select: "id,collaborateur_id,code_type_conge,date_debut,date_fin_absence,date_retour,debut_demi_journee,fin_demi_journee,nbr_jours_decomptes", limit: 10000,
          }),
          db.list<any>("ref_type_conge", { select: "code,libelle,code_rubrique_paie,code_type_jour", limit: 500 }).catch(() => []),
          db.list<any>("ref_jours_feries", { select: "date_debut,nombre_jours", limit: 2000 }).catch(() => []),
        ]);
        const typeParCode = new Map((typesConge as any[]).map((t) => [t.code, t]));
        // Même construction que DemandeCongeForm.tsx : un jour férié peut
        // s'étaler sur plusieurs jours consécutifs (nombre_jours)
        const feriesSet = new Set<string>();
        (feries as any[]).forEach((f) => {
          const nb = f.nombre_jours ?? 1;
          const d0 = new Date(f.date_debut + "T00:00:00");
          for (let i = 0; i < nb; i++) {
            const cur = new Date(d0); cur.setDate(cur.getDate() + i);
            feriesSet.add(cur.toISOString().split("T")[0]);
          }
        });
        // Recoupement avec la période (même règle que RG-EV-VALIDITE)
        const retenues = demandes.filter((d) =>
          parId.has(d.collaborateur_id) && d.date_debut <= periode.date_fin && d.date_retour >= periode.date_debut);

        const SANS_ASSOCIATION = "__SANS_ASSOCIATION__";
        const parCollab = new Map<string, Map<string, { jours: number; details: string[]; ids: string[] }>>();
        retenues.forEach((d) => {
          const t = typeParCode.get(d.code_type_conge);
          const libType = t?.libelle || d.code_type_conge || "Congé";
          const cleRub = t?.code_rubrique_paie || SANS_ASSOCIATION;
          // RG-CONGE-CHEVAUCHEMENT-02 (Adil DAIA) : recalcul exact des jours
          // qui tombent dans CETTE période, en reproduisant fidèlement
          // calcJoursAvecType() de DemandeCongeForm.tsx (jours ouvrés
          // OUV/ouvrables OUV2/calendaires CAL, fériés, demi-journées — ces
          // dernières uniquement aux vraies bornes de la demande, pas aux
          // coupures de période). Le total, une fois sommé sur toutes les
          // périodes couvertes, redonne exactement nbr_jours_decomptes.
          const joursPeriode = joursDansPeriode(d, periode, t?.code_type_jour ?? null, feriesSet);
          if (joursPeriode <= 0) return;
          const chevauche = d.date_debut < periode.date_debut || d.date_retour > periode.date_fin;
          if (!parCollab.has(d.collaborateur_id)) parCollab.set(d.collaborateur_id, new Map());
          const parRub = parCollab.get(d.collaborateur_id)!;
          const e = parRub.get(cleRub) || { jours: 0, details: [], ids: [] };
          e.jours += joursPeriode;
          e.ids.push(d.id);
          e.details.push(
            `${libType} ${formatDate(d.date_debut)}→${formatDate(d.date_retour)}` +
            (chevauche ? ` (${joursPeriode}j sur cette période / ${d.nbr_jours_decomptes}j au total)` : ""),
          );
          parRub.set(cleRub, e);
        });

        res.push(...[...parCollab.entries()].map(([cid, parRub]) => {
          const c = parId.get(cid)!;
          const valeurs: ValeurEV[] = [...parRub.entries()].map(([cleRub, e]) => {
            const codeRub = cleRub === SANS_ASSOCIATION ? null : cleRub;
            const rubOk = codeRub ? rubriquesParCode.get(codeRub) : null;
            const motifBlocage = !codeRub
              ? "Type de congé sans rubrique associée (à configurer dans Types de Congé)"
              : !rubOk
                ? `Rubrique ${codeRub} inconnue ou non saisissable`
                : !rubOk.v_ajout
                  ? `Rubrique ${codeRub} : type Ajout non autorisé`
                  : undefined;
            return {
              code_rubrique: codeRub ?? "—", attribut: "NOMBRE", libelleAttribut: "Nombre (jours de congé)",
              source_ev: "POINTAGE", valeur: e.jours,
              dejaPresent: codeRub ? dejaLa.has(`${cid}:${codeRub}`) : false,
              nonAutorise: motifBlocage,
              source_table: "cong_consommation", source_ids: e.ids,
            };
          });
          return {
            id: `CONGES:${cid}`, moduleOrigine: "CONGES" as Source,
            collaborateur_id: cid, matricule: c.matricule, nom: `${c.nom} ${c.prenom}`,
            detail: [...parRub.values()].flatMap((e) => e.details).join(" · "),
            valeurs,
          };
        }));
      }

      if (sources.includes("PRETS")) {
        // RG-PRET-VARPAIE-01 (Adil DAIA, révisé juillet 2026) : chaque prêt
        // porte DÉSORMAIS trois rubriques distinctes — capital
        // (rubrique_paie_code), intérêts HT (rubrique_paie_code_interet) et
        // TVA sur intérêts (rubrique_paie_code_tva) — copiées du référentiel
        // ref_type_pret à la création du prêt (pret_service.creer_pret()).
        // Auparavant un seul MONTANT fusionnait capital + intérêt sur une
        // unique rubrique ; les trois grandeurs comptables doivent être
        // imputées séparément (traitement fiscal différent des intérêts).
        // BASE = capital restant, NOMBRE = échéances restantes (inchangés,
        // toujours sur la rubrique capital).
        // RG-PRET-RECUP-STATUT-01 (Adil DAIA) : une échéance "forcee" (montant
        // ou date ajusté manuellement via l'onglet Actions du prêt) reste une
        // échéance due — elle doit continuer à être récupérée normalement pour
        // la paie, pas juste "planifiee". Sans ça elle n'est jamais prélevée
        // automatiquement une fois forcée. Filtre statut fait côté client
        // (pas de eq. unique) pour couvrir les deux statuts sans dépendre d'un
        // support d'opérateur IN côté client générique.
        const [echBrut, prets] = await Promise.all([
          db.list<any>("pret_echeances", {
            select: "pret_id,numero,date_echeance,statut,mt_capital,mt_interet,mt_tva_interet", limit: 10000,
          }),
          db.list<any>("prets", {
            imputable_paie: true, pret_suspendu: false,
            select: "id,collaborateur_id,rubrique_paie_code,rubrique_paie_code_interet,rubrique_paie_code_tva,capital_restant,echeance_restant,mt_echeance",
            limit: 10000,
          }),
        ]);
        const ech = echBrut.filter((e) => e.statut === "planifiee" || e.statut === "forcee");
        const pretParId = new Map((prets as any[]).map((p) => [p.id, p]));
        const dansPeriode = ech.filter((e) => e.date_echeance >= periode.date_debut && e.date_echeance <= periode.date_fin);

        const cumul = new Map<string, { capital: number; interet: number; tva: number; details: string[] }>();
        dansPeriode.forEach((e) => {
          const p = pretParId.get(e.pret_id);
          if (!p || !parId.has(p.collaborateur_id)) return;
          const x = cumul.get(e.pret_id) || { capital: 0, interet: 0, tva: 0, details: [] };
          x.capital += Number(e.mt_capital) || 0;
          x.interet += Number(e.mt_interet) || 0;
          x.tva += Number(e.mt_tva_interet) || 0;
          x.details.push(`Échéance n°${e.numero} du ${formatDate(e.date_echeance)}`);
          cumul.set(e.pret_id, x);
        });

        const motifPourRubrique = (codeRub: string | null | undefined, libZone: string): string | undefined => {
          const rubOk = codeRub ? rubriquesParCode.get(codeRub) : null;
          if (!codeRub) return `Aucune rubrique ${libZone} associée à ce prêt`;
          if (!rubOk) return `Rubrique ${codeRub} inconnue ou non saisissable`;
          if (!rubOk.v_ajout) return `Rubrique ${codeRub} : type Ajout non autorisé`;
          return undefined;
        };

        res.push(...[...cumul.entries()].map(([pretId, x]) => {
          const p = pretParId.get(pretId)!;
          const c = parId.get(p.collaborateur_id)!;
          const codeCapital = p.rubrique_paie_code as string | null;
          const codeInteret = p.rubrique_paie_code_interet as string | null;
          const codeTva = p.rubrique_paie_code_tva as string | null;

          const motifCapital = motifPourRubrique(codeCapital, "(capital)");
          // RG-PRET-VARPAIE-02 (confirmé Adil DAIA, révision) : la rubrique
          // capital/mensualité porte désormais le TOTAL TTC de l'échéance
          // (capital + intérêts + TVA) — c'est le montant réellement retenu
          // sur le net. La rubrique intérêts porte les intérêts TTC
          // (intérêts + TVA), et la rubrique TVA continue de porter la TVA
          // seule — utilisée à des fins de déclaration/comptabilisation
          // séparée, pas de retenue supplémentaire sur le net.
          const totalTtc = x.capital + x.interet + x.tva;
          const interetTtc = x.interet + x.tva;
          const valeurs: ValeurEV[] = [
            { code_rubrique: codeCapital ?? "—", attribut: "BASE", libelleAttribut: "Base (capital restant)", source_ev: "BATCH",
              valeur: Number(p.capital_restant) || 0,
              dejaPresent: codeCapital ? dejaLa.has(`${p.collaborateur_id}:${codeCapital}`) : false, nonAutorise: motifCapital,
              source_table: "prets", source_ids: [pretId] },
            { code_rubrique: codeCapital ?? "—", attribut: "NOMBRE", libelleAttribut: "Nombre (échéances restantes)", source_ev: "BATCH",
              valeur: Number(p.echeance_restant) || 0,
              dejaPresent: codeCapital ? dejaLa.has(`${p.collaborateur_id}:${codeCapital}`) : false, nonAutorise: motifCapital,
              source_table: "prets", source_ids: [pretId] },
            // Valeur POSITIVE (Adil DAIA, juillet 2026) : la classification de
            // la rubrique (flux = 'RET' dans le paramétrage) fait déjà
            // soustraire ce montant du net — inutile de porter un signe
            // négatif sur l'EV lui-même, qui n'a plus de colonne `sens`.
            { code_rubrique: codeCapital ?? "—", attribut: "MONTANT", libelleAttribut: "Montant (capital + intérêts TTC de la période)", source_ev: "BATCH",
              valeur: totalTtc,
              dejaPresent: codeCapital ? dejaLa.has(`${p.collaborateur_id}:${codeCapital}`) : false, nonAutorise: motifCapital,
              source_table: "prets", source_ids: [pretId] },
          ];
          // Intérêts TTC (intérêts + TVA) — seulement si le prêt en génère réellement sur la période
          if (interetTtc !== 0) {
            const motifInteret = motifPourRubrique(codeInteret, "intérêts");
            valeurs.push({
              code_rubrique: codeInteret ?? "—", attribut: "MONTANT", libelleAttribut: "Montant (intérêts TTC de la période)", source_ev: "BATCH",
              valeur: interetTtc,
              dejaPresent: codeInteret ? dejaLa.has(`${p.collaborateur_id}:${codeInteret}`) : false, nonAutorise: motifInteret,
              source_table: "prets", source_ids: [pretId],
            });
          }
          // TVA sur intérêts, seule — seulement si un taux de TVA s'applique réellement
          if (x.tva !== 0) {
            const motifTva = motifPourRubrique(codeTva, "TVA intérêts");
            valeurs.push({
              code_rubrique: codeTva ?? "—", attribut: "MONTANT", libelleAttribut: "Montant (TVA intérêts de la période)", source_ev: "BATCH",
              valeur: x.tva,
              dejaPresent: codeTva ? dejaLa.has(`${p.collaborateur_id}:${codeTva}`) : false, nonAutorise: motifTva,
              source_table: "prets", source_ids: [pretId],
            });
          }

          return {
            id: `PRETS:${pretId}`, moduleOrigine: "PRETS" as Source,
            collaborateur_id: p.collaborateur_id, matricule: c.matricule, nom: `${c.nom} ${c.prenom}`,
            detail: x.details.join(" · "), valeurs,
          };
        }));
      }

      res.sort((a, b) => a.matricule.localeCompare(b.matricule) || a.moduleOrigine.localeCompare(b.moduleOrigine));
      setLignes(res); setAAnalyse(true);
      const aCreer = res.reduce((n, l) => n + l.valeurs.filter((v) => !v.dejaPresent && !v.nonAutorise && v.valeur !== 0).length, 0);
      toast({
        title: "Analyse terminée",
        description: res.length
          ? `${res.length} ligne(s) — ${aCreer} élément(s) à générer.`
          : "Aucun élément à récupérer sur cette période.",
      });
    } catch (e: any) {
      toast({ title: "Extraction impossible", description: e.message, variant: "destructive" });
    }
    setAnalyse(false);
  };

  // RG-RECUP-LISTER-ELV-01 (Adil DAIA) : liste les EV déjà générés pour cette
  // période, filtrés sur les modules actuellement cochés (via source_table),
  // pour permettre une revue/validation avant clôture, et un "tout supprimer"
  // pour reprendre la récupération à zéro en cas d'erreur.
  const listerElv = async () => {
    if (!periodeId) { toast({ title: "Choisissez une période", variant: "destructive" }); return; }
    if (sources.length === 0) { toast({ title: "Cochez au moins un module", variant: "destructive" }); return; }
    setFiltreElvTexte(""); setFiltreElvModule("TOUS"); setFiltreElvStatut("TOUS");
    setChargementElv(true);
    try {
      const tables = sources.map((s) => SOURCE_TABLE_PAR_CODE[s]);
      const evs = (await db.list<ElvExistant>("element_variable", {
        periode_id: periodeId,
        select: "id,collaborateur_id,code_rubrique,source_table,valeur_base,valeur_nombre,valeur_montant,statut",
        limit: 10000,
      })).filter((e) => e.source_table && tables.includes(e.source_table));

      const idsCollab = Array.from(new Set(evs.map((e) => e.collaborateur_id)));
      const collabs = idsCollab.length
        ? await db.list<Collab>("collaborateurs", { select: "id,matricule,nom,prenom", limit: 10000 })
        : [];
      const parId = new Map(collabs.map((c) => [c.id, c]));

      setElvExistants(evs.map((e) => ({ ...e, matricule: parId.get(e.collaborateur_id)?.matricule, nom: `${parId.get(e.collaborateur_id)?.nom ?? ""} ${parId.get(e.collaborateur_id)?.prenom ?? ""}`.trim() })));
    } catch (e: any) {
      toast({ title: "Impossible de lister les EV", description: e.message, variant: "destructive" });
    }
    setChargementElv(false);
  };

  const validerLotElv = async () => {
    const aValider = elvFiltres.filter((e) => e.statut === "SAISI");
    if (aValider.length === 0) return;
    if (!confirm(`Valider ${aValider.length} élément(s) variable(s) ? Ils seront alors pris en compte par le calcul de paie.`)) return;
    setValidationLot(true);
    try {
      for (const e of aValider) {
        await db.update("element_variable", { id: e.id }, { statut: "VALIDE", valide_le: new Date().toISOString() });
      }
      const idsValides = new Set(aValider.map((e) => e.id));
      toast({ title: `${aValider.length} élément(s) validé(s)` });
      setElvExistants((prev) => prev?.map((e) => (idsValides.has(e.id) ? { ...e, statut: "VALIDE" } : e)) ?? null);
    } catch (e: any) {
      toast({ title: "Validation incomplète", description: e.message, variant: "destructive" });
      listerElv(); // recharge l'état réel après un échec partiel
    }
    setValidationLot(false);
  };

  const supprimerLotElv = async () => {
    if (elvFiltres.length === 0) return;
    if (!confirm(`Supprimer les ${elvFiltres.length} élément(s) variable(s) affiché(s) ? Cette action est irréversible — vous pourrez relancer la récupération ensuite.`)) return;
    setSuppressionLot(true);
    try {
      const idsSupprimes = new Set(elvFiltres.map((e) => e.id));
      for (const e of elvFiltres) {
        await db.remove("element_variable", { id: e.id });
      }
      toast({ title: `${elvFiltres.length} élément(s) supprimé(s)`, description: "Vous pouvez relancer Analyser puis Générer." });
      setElvExistants((prev) => prev?.filter((e) => !idsSupprimes.has(e.id)) ?? null);
    } catch (e: any) {
      toast({ title: "Suppression incomplète", description: e.message, variant: "destructive" });
      listerElv(); // recharge l'état réel après un échec partiel
    }
    setSuppressionLot(false);
  };

  // RG-RECUP-LISTER-ELV-02 (Adil DAIA) : filtre puis trie la liste des EV
  // déjà générés. Filtre d'abord (texte/module/statut), puis useTableSort
  // sur le résultat filtré — appelé inconditionnellement (règle des Hooks),
  // même si elvExistants est encore null (tableau vide dans ce cas).
  const elvFiltres = (elvExistants ?? []).filter((e) => {
    if (filtreElvStatut !== "TOUS" && e.statut !== filtreElvStatut) return false;
    if (filtreElvModule !== "TOUS" && e.source_table !== SOURCE_TABLE_PAR_CODE[filtreElvModule]) return false;
    if (filtreElvTexte.trim()) {
      const q = filtreElvTexte.trim().toLowerCase();
      const hay = `${e.matricule ?? ""} ${e.nom ?? ""} ${e.code_rubrique}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const { sortedData: elvTries, toggleSort: toggleSortElv, SortIcon: SortIconElv } = useTableSort(elvFiltres, { column: "matricule", direction: "asc" });

  const aGenerer = useMemo(
    () => lignes.flatMap((l) => l.valeurs.filter((v) => !v.dejaPresent && !v.nonAutorise && v.valeur !== 0)
      .map((v) => ({ ...v, collaborateur_id: l.collaborateur_id }))),
    [lignes],
  );

  // ---------- Génération ----------
  const generer = async () => {
    if (!aGenerer.length || !periode) return;
    // Un EV = une ligne (migration 46) : on regroupe tout ce qui vise la
    // même (collaborateur, rubrique) — ex. BASE + NOMBRE + MONTANT d'un même
    // prêt sur sa rubrique capital — en une seule ligne element_variable,
    // une colonne dédiée par grandeur (valeur_base/valeur_nombre/
    // valeur_taux/valeur_montant), au lieu d'une ligne par attribut.
    const ATTR_VERS_COLONNE: Record<string, string> = {
      BASE: "valeur_base", NOMBRE: "valeur_nombre", TAUX: "valeur_taux", MONTANT: "valeur_montant",
    };
    const groupes = new Map<string, { collaborateur_id: string; code_rubrique: string; source_ev: string; colonnes: Record<string, number>; source_table?: string; source_ids: Set<string> }>();
    aGenerer.forEach((v) => {
      const cle = `${v.collaborateur_id}:${v.code_rubrique}`;
      const g = groupes.get(cle) || { collaborateur_id: v.collaborateur_id, code_rubrique: v.code_rubrique, source_ev: v.source_ev, colonnes: {}, source_table: v.source_table, source_ids: new Set<string>() };
      g.colonnes[ATTR_VERS_COLONNE[v.attribut]] = v.valeur;
      (v.source_ids || []).forEach((id) => g.source_ids.add(id));
      groupes.set(cle, g);
    });
    const lignesAEcrire = [...groupes.values()];

    if (!confirm(`Générer ${lignesAEcrire.length} élément(s) variable(s) au statut SAISI ?`)) return;
    setGeneration(true);
    try {
      await db.create("element_variable", lignesAEcrire.map((g) => ({
        collaborateur_id: g.collaborateur_id, periode_id: periodeId,
        code_rubrique: g.code_rubrique, ...g.colonnes,
        code_type: "AJOUT", code_source: g.source_ev, statut: "SAISI",
        date_debut: periode.date_debut, date_fin: periode.date_fin,
        // RG-EV-SOURCE-TRACABILITE-01 : permet d'afficher la période de
        // traitement sur la ligne d'origine (congé/prêt) une fois cet EV
        // généré, et de retrouver précisément les lignes sources agrégées.
        source_table: g.source_table ?? null,
        source_ids: g.source_ids.size ? [...g.source_ids] : null,
      })));
      toast({ title: "Éléments générés", description: `${lignesAEcrire.length} élément(s) variable(s) créé(s) au statut SAISI. Validez-les pour les prendre en compte.` });
      analyser();
    } catch (e: any) {
      toast({ title: "Erreur de génération", description: e.message, variant: "destructive" });
    }
    setGeneration(false);
  };

  return (
    <div className="p-5 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Récupération des modules</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Génère des éléments variables à partir des autres modules du SIRH. Rien n'est écrit avant l'aperçu ;
          les éléments sont créés au statut <strong>SAISI</strong>.
        </p>
      </div>

      {/* Modules concernés — sélection multiple */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {SOURCES.map(({ code, label, desc, icone: Icone }) => {
          const coche = sources.includes(code);
          return (
            <button key={code} onClick={() => toggleSource(code)}
              className={`flex items-start gap-3 p-4 rounded-xl border text-left transition-colors ${
                coche ? "border-accent bg-accent/5" : "border-border hover:border-accent/40"}`}>
              <Checkbox checked={coche} className="mt-1 pointer-events-none" />
              <div className={`p-2 rounded-lg ${coche ? "bg-accent/15 text-accent" : "bg-muted text-muted-foreground"}`}>
                <Icone size={18} />
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">{label}</div>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Contexte */}
      <div className="rounded-xl border border-border p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <Label className="text-xs">Plan de paie</Label>
          <Select value={planId} onValueChange={setPlanId}>
            <SelectTrigger><SelectValue placeholder="…" /></SelectTrigger>
            <SelectContent>{plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.code} · {p.libelle}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Période</Label>
          <Select value={periodeId} onValueChange={setPeriodeId}>
            <SelectTrigger><SelectValue placeholder="…" /></SelectTrigger>
            <SelectContent>
              {periodes.map((p) => {
                const cloturee = p.statut === "CLOTUREE" || p.statut === "FERMEE";
                const nonOuverte = !cloturee && p.date_ouverture && p.date_ouverture > new Date().toISOString().slice(0, 10);
                return (
                  <SelectItem key={p.id} value={p.id}>
                    {MOIS[p.mois]} {p.annee}
                    {cloturee && <span style={{ color: "hsl(var(--destructive))" }}> · clôturée</span>}
                    {nonOuverte && <span style={{ color: "hsl(var(--warning))" }}> · non ouverte</span>}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button onClick={analyser} disabled={!periodeOuverte || sources.length === 0 || analyse} className="gap-1.5 w-full">
            {analyse ? <Loader2 className="animate-spin" size={14} /> : <Download size={14} />} Analyser
          </Button>
        </div>
      </div>

      {periode && !periodeOuverte && (() => {
        const cloturee = periode.statut === "CLOTUREE" || periode.statut === "FERMEE";
        const token = cloturee ? "destructive" : "warning";
        return (
          <div className="rounded-lg px-3 py-2 text-xs flex items-center gap-2"
            style={{ border: `1px solid hsl(var(--${token}) / 0.3)`, background: `hsl(var(--${token}) / 0.08)`, color: `hsl(var(--${token}))` }}>
            <AlertTriangle size={14} />
            {cloturee
              ? "Cette période est clôturée — la récupération est désactivée."
              : `Cette période n'est pas ouverte ${periode.date_ouverture ? `(ouverture le ${formatDate(periode.date_ouverture)})` : ""} — la récupération est désactivée.`}
          </div>
        );
      })()}

      {/* RG-RECUP-LISTER-ELV-01 : revue des EV déjà générés pour les modules cochés */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-muted/30">
          <div>
            <p className="text-sm font-semibold">Éléments variables déjà générés</p>
            <p className="text-xs text-muted-foreground">Pour les modules cochés ci-dessus, sur la période sélectionnée — à valider, ou à supprimer pour reprendre la récupération à zéro.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={listerElv} disabled={!periodeId || sources.length === 0 || chargementElv} className="gap-1.5">
              {chargementElv ? <Loader2 className="animate-spin" size={14} /> : <ListChecks size={14} />} Lister les EV
            </Button>
            {elvFiltres.some((e) => e.statut === "SAISI") && (
              <Button size="sm" onClick={validerLotElv} disabled={validationLot} className="gap-1.5">
                {validationLot ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}
                Valider le lot ({elvFiltres.filter((e) => e.statut === "SAISI").length})
              </Button>
            )}
            {elvFiltres.length > 0 && (
              <Button variant="destructive" size="sm" onClick={supprimerLotElv} disabled={suppressionLot} className="gap-1.5">
                {suppressionLot ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />} Supprimer le lot ({elvFiltres.length})
              </Button>
            )}
          </div>
        </div>

        {elvExistants && elvExistants.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-t border-border bg-background">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={filtreElvTexte} onChange={(e) => setFiltreElvTexte(e.target.value)}
                placeholder="Matricule, nom, rubrique…" className="h-8 pl-7 text-xs" />
            </div>
            <Select value={filtreElvModule} onValueChange={(v) => setFiltreElvModule(v as "TOUS" | Source)}>
              <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TOUS">Tous les modules</SelectItem>
                <SelectItem value="CONGES">Congés</SelectItem>
                <SelectItem value="PRETS">Prêts</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtreElvStatut} onValueChange={(v) => setFiltreElvStatut(v as "TOUS" | "SAISI" | "VALIDE")}>
              <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TOUS">Tous statuts</SelectItem>
                <SelectItem value="SAISI">Saisi</SelectItem>
                <SelectItem value="VALIDE">Validé</SelectItem>
              </SelectContent>
            </Select>
            {(filtreElvTexte || filtreElvModule !== "TOUS" || filtreElvStatut !== "TOUS") && (
              <button onClick={() => { setFiltreElvTexte(""); setFiltreElvModule("TOUS"); setFiltreElvStatut("TOUS"); }}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
                Réinitialiser
              </button>
            )}
            <span className="text-xs text-muted-foreground ml-auto">{elvFiltres.length} / {elvExistants.length} affiché(s)</span>
          </div>
        )}

        {elvExistants && (
          elvExistants.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Aucun élément variable trouvé pour ces modules sur cette période.</p>
          ) : elvFiltres.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Aucun résultat pour ces filtres.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/20">
                  <th onClick={() => toggleSortElv("matricule")} className="px-4 py-2 text-left font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors">
                    Matricule <SortIconElv column="matricule" />
                  </th>
                  <th onClick={() => toggleSortElv("nom")} className="px-4 py-2 text-left font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors">
                    Collaborateur <SortIconElv column="nom" />
                  </th>
                  <th onClick={() => toggleSortElv("code_rubrique")} className="px-4 py-2 text-left font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors">
                    Rubrique <SortIconElv column="code_rubrique" />
                  </th>
                  <th onClick={() => toggleSortElv("source_table")} className="px-4 py-2 text-left font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors">
                    Module <SortIconElv column="source_table" />
                  </th>
                  <th onClick={() => toggleSortElv("valeur_montant")} className="px-4 py-2 text-right font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors">
                    Valeur <SortIconElv column="valeur_montant" />
                  </th>
                  <th onClick={() => toggleSortElv("statut")} className="px-4 py-2 text-left font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors">
                    Statut <SortIconElv column="statut" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {elvTries.map((e) => (
                  <tr key={e.id} className="border-t border-border hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2 font-mono">{e.matricule ?? "—"}</td>
                    <td className="px-4 py-2">{e.nom ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-accent">{e.code_rubrique}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {e.source_table === "cong_consommation" ? "Congés" : e.source_table === "prets" ? "Prêts" : e.source_table}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {e.valeur_montant != null ? formatMoney(e.valeur_montant) : e.valeur_nombre != null ? formatNumber(e.valeur_nombre) : e.valeur_base != null ? formatNumber(e.valeur_base) : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                        style={e.statut === "VALIDE"
                          ? { background: "hsl(var(--success) / 0.15)", color: "hsl(var(--success))" }
                          : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                        {e.statut}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>

      {/* Aperçu */}
      {aAnalyse && (
        <>
          {(() => {
            const totalValeurs = lignes.reduce((n, l) => n + l.valeurs.length, 0);
            const ignorees = totalValeurs - aGenerer.length;
            return (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium"
                    style={{ background: "hsl(var(--success) / 0.12)", color: "hsl(var(--success))" }}>
                    <CheckCircle2 size={14} /> {aGenerer.length} à générer
                  </span>
                  {ignorees > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium"
                      style={{ background: "hsl(var(--warning) / 0.12)", color: "hsl(var(--warning))" }}
                      title="Déjà présent, valeur nulle, ou rubrique non autorisée">
                      <AlertTriangle size={14} /> {ignorees} ignoré(s)
                    </span>
                  )}
                </div>
                <Button onClick={generer} disabled={!aGenerer.length || generation || !periodeOuverte} className="gap-1.5">
                  {generation ? <Loader2 className="animate-spin" size={14} /> : <Play size={14} />}
                  Générer {aGenerer.length} élément(s)
                </Button>
              </div>
            );
          })()}

          <div className="rounded-xl border border-border overflow-x-auto max-h-[28rem]">
            <Table>
              <TableHeader className="sticky top-0" style={{ background: "hsl(var(--muted) / 0.5)" }}>
                <TableRow className="text-[10px] uppercase tracking-wide font-semibold hover:bg-transparent">
                  <TableHead className="w-24 py-2">Module</TableHead>
                  <TableHead className="w-24 py-2">Matricule</TableHead>
                  <TableHead className="w-52 py-2">Collaborateur</TableHead>
                  <TableHead className="py-2">Origine</TableHead>
                  <TableHead className="py-2">Valeur(s) à générer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lignes.map((l) => (
                  <TableRow key={l.id} className="text-xs align-top border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                    style={{ borderLeft: `2px solid hsl(var(${l.moduleOrigine === "CONGES" ? "--info" : "--primary"}) / 0.5)` }}>
                    <TableCell className="pt-3">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                        style={l.moduleOrigine === "CONGES"
                          ? { background: "hsl(var(--info) / 0.15)", color: "hsl(var(--info))" }
                          : { background: "hsl(var(--primary) / 0.15)", color: "hsl(var(--primary))" }}>
                        {SOURCE_PAR_CODE.get(l.moduleOrigine)?.label.split(" ")[0]}
                      </span>
                    </TableCell>
                    <TableCell className="pt-3"><code className="text-[11px]">{l.matricule}</code></TableCell>
                    <TableCell className="font-medium truncate max-w-[13rem] pt-3">{l.nom}</TableCell>
                    <TableCell className="text-muted-foreground truncate pt-3" title={l.detail}>{l.detail}</TableCell>
                    <TableCell className="py-2">
                      <div className="flex flex-col gap-1">
                        {l.valeurs.map((v, i) => (
                          <div key={i} className={`flex items-center gap-2 ${v.dejaPresent || v.nonAutorise ? "opacity-50" : ""}`}>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground w-16 text-center shrink-0">{v.attribut}</span>
                            <span className="tabular-nums font-medium w-24 text-right shrink-0">
                              {v.attribut === "MONTANT" ? formatMoney(v.valeur) : formatNumber(v.valeur)}
                            </span>
                            <code className="text-[10px] text-accent shrink-0">{v.code_rubrique}</code>
                            {v.nonAutorise ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive truncate" title={v.nonAutorise}>{v.nonAutorise}</span>
                            ) : v.dejaPresent ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">Déjà présent</span>
                            ) : v.valeur === 0 ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">Valeur nulle</span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--success) / 0.15)", color: "hsl(var(--success))" }}>À générer</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {lignes.length === 0 && (
                  <TableRow className="hover:bg-transparent"><TableCell colSpan={5} className="text-center py-10 text-sm text-muted-foreground">
                    Aucun élément à récupérer sur cette période.
                  </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <p className="text-[11px] text-muted-foreground">
        Les éléments sont créés avec le type <strong>Ajout</strong> et la validité de la période — source{" "}
        <strong>POINTAGE</strong> pour les congés, <strong>BATCH</strong> pour les prêts. Un élément déjà présent
        sur la même rubrique pour un collaborateur est ignoré (pas de doublon).
      </p>
    </div>
  );
};

export default RecuperationModulesPage;
