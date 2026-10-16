// src/pages/paie/compta/GenerationEcrituresPage.tsx
//
// Génération des écritures comptables à partir des bulletins validés d'un
// plan de paie et d'une période.
//
// Style aligné sur TraitementPaiePage.tsx / VueTraitementPage.tsx :
// composants shadcn/ui (Card, Table, Select, Button, Badge, Skeleton) et
// couleurs exclusivement via variables CSS sémantiques (--success, --warning,
// --destructive, --accent, --info, --muted-foreground...), jamais de palette
// Tailwind figée (amber-*, emerald-*...) — pour respecter la préférence
// d'apparence (clair/sombre, accent) choisie par chaque utilisateur.
// Dates/montants formatés via useFormatMasks() (même hook que
// TraitementPaiePage.tsx) pour respecter les préférences de format.

import { Fragment, useEffect, useMemo, useState } from "react";
import { db } from "@/lib/api";
import BalanceEcrituresAccordion from "@/components/paie/compta/BalanceEcrituresAccordion";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  comptaApi,
  type ControleEffectif,
  type Lot,
  type FormatExport,
  type ModeGeneration,
  type AnomalieLigne,
  type AnomalieParametrage,
  type EcartAxe,
  type LigneBrute,
  type RubriqueSansImputation,
  type DetailEcrituresLot,
} from "@/lib/comptaApi";
import { useFormatMasks } from "@/hooks/useFormatMasks";
import {
  CheckCircle2, AlertTriangle, Download, RefreshCw, Users, UserCheck,
  UserX, Scale, FileSpreadsheet, Wallet, Layers, ChevronDown, ChevronRight,
  ChevronsUpDown, ArrowUp, ArrowDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

// ---- Pill d'état : même pattern que statutBadge() dans VueTraitementPage.tsx
// (pastille + libellé, fond à 10% d'opacité, liseré à 25%) — `tone` est un nom
// de variable CSS (--success, --warning...), jamais une couleur Tailwind fixe.
function Pill({ tone, label, icon: Icon }: { tone: string; label: string; icon?: React.ElementType }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{
        background: `hsl(var(${tone}) / 0.1)`,
        color: `hsl(var(${tone}))`,
        boxShadow: `inset 0 0 0 1px hsl(var(${tone}) / 0.25)`,
      }}
    >
      {Icon ? <Icon size={12} /> : <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: `hsl(var(${tone}))` }} />}
      {label}
    </span>
  );
}

// Bandeau d'alerte (forçage, confirmation de régénération, avertissement de
// paramétrage) — un seul composant réutilisé partout, toujours sur --warning
// ou --destructive selon la gravité, jamais de amber-*/red-* codés en dur.
function AlertBanner({
  tone = "--warning", icon: Icon = AlertTriangle, children,
}: { tone?: string; icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg px-4 py-3 text-sm"
      style={{
        background: `hsl(var(${tone}) / 0.08)`,
        boxShadow: `inset 0 0 0 1px hsl(var(${tone}) / 0.3)`,
        color: `hsl(var(--foreground))`,
      }}
    >
      <div className="flex items-start gap-2">
        <Icon size={16} className="mt-0.5 shrink-0" style={{ color: `hsl(var(${tone}))` }} />
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}

// Carte KPI façon Stat() de VueTraitementPage.tsx : icône + libellé en petit,
// valeur en gros — `tone` est un nom de variable CSS, pas une classe fixe.
function KpiCard({
  icon: Icon, label, value, sub, tone, valueIcon: ValueIcon,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  tone?: string; // ex. "--success", "--warning", "--destructive" — omis = --foreground
  valueIcon?: React.ElementType; // icône affichée à côté de la valeur (ex. statut OK/KO dynamique)
}) {
  return (
    <Card>
      <CardContent className="p-3.5">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
          <Icon size={13} />
          <span>{label}</span>
        </div>
        <div
          className="text-xl font-semibold tabular-nums flex items-center gap-1.5"
          style={tone ? { color: `hsl(var(${tone}))` } : undefined}
        >
          {ValueIcon && <ValueIcon size={18} className="shrink-0" />}
          {value}
        </div>
        {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ── Tri générique de tableau (clic sur l'en-tête de colonne) ──────────────
// `colonnes` associe un nom de colonne à un extracteur de valeur comparable
// (string ou number) sur une ligne. Cycle au clic : asc -> desc -> aucun tri.
function useTriTable<T>(lignes: T[], colonnes: Record<string, (l: T) => string | number>) {
  const [tri, setTri] = useState<{ colonne: string; sens: "asc" | "desc" } | null>(null);
  const lignesTriees = useMemo(() => {
    if (!tri) return lignes;
    const extraire = colonnes[tri.colonne];
    if (!extraire) return lignes;
    const copie = [...lignes].sort((a, b) => {
      const va = extraire(a), vb = extraire(b);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "fr");
      return tri.sens === "asc" ? cmp : -cmp;
    });
    return copie;
  }, [lignes, tri, colonnes]);
  const trierPar = (colonne: string) =>
    setTri((prev) => {
      if (prev?.colonne !== colonne) return { colonne, sens: "asc" };
      if (prev.sens === "asc") return { colonne, sens: "desc" };
      return null;
    });
  return { lignesTriees, tri, trierPar };
}

/** En-tête de colonne cliquable pour trier — même TableHead, juste interactif. */
function ThTriable({
  label, colonne, tri, trierPar, align, style,
}: {
  label: string;
  colonne: string;
  tri: { colonne: string; sens: "asc" | "desc" } | null;
  trierPar: (colonne: string) => void;
  align?: "right";
  style?: React.CSSProperties;
}) {
  const actif = tri?.colonne === colonne;
  return (
    <TableHead
      onClick={() => trierPar(colonne)}
      style={style}
      className={`cursor-pointer select-none hover:text-foreground transition-colors ${align === "right" ? "text-right" : ""}`}
    >
      <span className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}>
        {label}
        {actif ? (
          tri!.sens === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />
        ) : (
          <ChevronsUpDown size={11} className="text-muted-foreground/50" />
        )}
      </span>
    </TableHead>
  );
}

// ── Débit / Crédit en couleurs distinctes — --info pour le débit, --accent
// pour le crédit (variables de thème, jamais de couleur Tailwind fixe). ──
function MontantDebit({ value, formatMoney }: { value: number; formatMoney: (n: number) => string }) {
  return <span style={{ color: "hsl(var(--info))" }}>{formatMoney(value)}</span>;
}
function MontantCredit({ value, formatMoney }: { value: number; formatMoney: (n: number) => string }) {
  return <span style={{ color: "hsl(var(--accent))" }}>{formatMoney(value)}</span>;
}

interface PlanPaie {
  id: string;
  code: string;
  libelle: string;
  frequence: string;
}

interface Periode {
  id: string;
  annee: number;
  mois: number;
  numero_periode: number;
  intitule: string | null;
  statut: string;
  date_debut: string;
  date_fin: string;
  date_ouverture: string | null;
}

// Granularité verrouillée sur NOMINATIF (05/08) : plus de choix GLOBAL côté
// écran — chaque écriture doit rester traçable jusqu'à l'agent/la rubrique.
const MODE_FIXE: { value: ModeGeneration; label: string; description: string } = {
  value: "NOMINATIF", label: "Détail nominatif",
  description: "Une ligne par collaborateur et par compte — traçabilité maximale jusqu'à l'agent et la rubrique.",
};

export default function GenerationEcrituresPage() {
  const { formatMoney, formatDate } = useFormatMasks();

  // Sélection
  const [plans, setPlans] = useState<PlanPaie[]>([]);
  const [planPaieId, setPlanPaieId] = useState<string>("");
  const [periodes, setPeriodes] = useState<Periode[]>([]);
  const [anneeSelectionnee, setAnneeSelectionnee] = useState<number | "">("");
  const [periodeId, setPeriodeId] = useState<string>("");
  const [modeGeneration] = useState<ModeGeneration>("NOMINATIF");

  // État
  const [lot, setLot] = useState<Lot | null>(null);
  const [controle, setControle] = useState<ControleEffectif | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalieLigne[]>([]);
  const [anomaliesParametrage, setAnomaliesParametrage] = useState<AnomalieParametrage[]>([]);
  const [desequilibre, setDesequilibre] = useState<EcartAxe[] | null>(null);
  const [axeDeplie, setAxeDeplie] = useState<string | null>(null);
  const [lignesBrutes, setLignesBrutes] = useState<LigneBrute[] | null>(null);
  const [libelleComptes, setLibelleComptes] = useState<Map<string, string>>(new Map());
  const [libelleRubriques, setLibelleRubriques] = useState<Map<string, string>>(new Map());
  const [compteDeplie, setCompteDeplie] = useState<string | null>(null);
  const [rubriqueDepliee, setRubriqueDepliee] = useState<string | null>(null);
  // Agent sélectionné dans le déséquilibre (clic sur une ligne collaborateur)
  // -> affiche son relevé complet (tous comptes confondus), pas juste l'axe
  // en écart.
  const [collaborateurFocus, setCollaborateurFocus] = useState<{ id: string; matricule: string; nom: string } | null>(null);
  // Panneau "Rubriques non imputées" (bouton dans le relevé collaborateur) —
  // chargé à la demande (pas au montage de la page) et mis en cache une fois
  // récupéré, avec recherche texte et filtre par catégorie.
  const [afficherRSI, setAfficherRSI] = useState(false);
  const [rubriquesSansImputation, setRubriquesSansImputation] = useState<RubriqueSansImputation[] | null>(null);
  const [chargementRSI, setChargementRSI] = useState(false);
  const [rechercheRSI, setRechercheRSI] = useState("");
  const [categorieRSI, setCategorieRSI] = useState<"TOUS" | "ASS" | "CALC" | "COT">("TOUS");
  // Balance des écritures persistées (Compte -> Rubrique -> Matricule),
  // consultable directement sur cet écran dès que le lot est généré — voir
  // BalanceEcrituresAccordion.tsx (05/08), réutilisé plus tard sur
  // VueComptabilitePage.tsx.
  const [detailEcritures, setDetailEcritures] = useState<DetailEcrituresLot | null>(null);
  const [chargementDetail, setChargementDetail] = useState(false);
  const [formats, setFormats] = useState<FormatExport[]>([]);
  const [formatChoisi, setFormatChoisi] = useState<string>("");
  // Lot déjà généré (statut GENERE/EXPORTE/COMPTABILISE) : on demande
  // confirmation avant de relancer la génération (MODULE_COMPTA_PAIE.md §3.3).
  // On mémorise le `forcer` en attente pour le rejouer après confirmation.
  const [confirmationRegeneration, setConfirmationRegeneration] = useState<{ forcer: boolean } | null>(null);

  const [chargementPlans, setChargementPlans] = useState(true);
  const [chargementPeriodes, setChargementPeriodes] = useState(false);
  const [enCours, setEnCours] = useState<"controle" | "generation" | "export" | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  // ---- Chargement initial : plans de paie actifs + formats d'export ----
  useEffect(() => {
    setChargementPlans(true);
    db.list<PlanPaie>("plan_paie", { actif: true, select: "id,code,libelle,frequence", order: "libelle" })
      .then((data) => {
        setPlans(data);
        if (data.length === 1) setPlanPaieId(data[0].id);
      })
      .catch((e) => setErreur(e.message))
      .finally(() => setChargementPlans(false));

    comptaApi.listerFormats()
      .then((f) => { setFormats(f); if (f.length) setFormatChoisi(f[0].code); })
      .catch(() => {});
  }, []);

  // ---- Cascade : périodes du plan sélectionné ----
  useEffect(() => {
    setAnneeSelectionnee("");
    setPeriodeId("");
    setPeriodes([]);
    reinitialiserLot();
    if (!planPaieId) return;
    setChargementPeriodes(true);
    db.list<Periode>("calendrier_paie", {
      plan_paie_id: planPaieId,
      select: "id,annee,mois,numero_periode,intitule,statut,date_debut,date_fin,date_ouverture",
    })
      .then(setPeriodes)
      .catch((e) => setErreur(e.message))
      .finally(() => setChargementPeriodes(false));
  }, [planPaieId]);

  useEffect(() => {
    setPeriodeId("");
    reinitialiserLot();
  }, [anneeSelectionnee]);

  useEffect(() => {
    reinitialiserLot();
  }, [periodeId, modeGeneration]);

  function reinitialiserLot() {
    setLot(null);
    setControle(null);
    setAnomalies([]);
    setAnomaliesParametrage([]);
    setDesequilibre(null);
    setAxeDeplie(null);
    setLignesBrutes(null);
    setCompteDeplie(null);
    setRubriqueDepliee(null);
    setCollaborateurFocus(null);
    setErreur(null);
    setDetailEcritures(null);
  }

  // Libellés de compte/rubrique pour l'affichage (le relevé et la vue par
  // compte n'ont que les codes bruts) — chargés une seule fois dès qu'il y a
  // des lignes à afficher, pas à chaque rendu.
  useEffect(() => {
    if (!lignesBrutes || lignesBrutes.length === 0) return;
    db.list<{ code_compte: string; intitule_compte: string }>("ref_imputation_comptable", {
      actif: true,
      select: "code_compte,intitule_compte",
    })
      .then((rows) => setLibelleComptes(new Map(rows.map((r) => [r.code_compte, r.intitule_compte]))))
      .catch(() => {});
    db.list<{ code: string; libelle: string }>("rubrique_paie", { select: "code,libelle" })
      .then((rows) => setLibelleRubriques(new Map(rows.map((r) => [r.code, r.libelle]))))
      .catch(() => {});
  }, [lignesBrutes]);

  function libelleCompte(code: string) {
    const l = libelleComptes.get(code);
    return l ? `${code} — ${l}` : code;
  }
  function libelleRubrique(code: string) {
    const l = libelleRubriques.get(code);
    return l ? `${code} — ${l}` : code;
  }

  function toggleRubriquesSansImputation() {
    const ouverture = !afficherRSI;
    setAfficherRSI(ouverture);
    if (ouverture && rubriquesSansImputation === null) {
      setChargementRSI(true);
      comptaApi.imputationsManquantes(lot?.plan_paie_id, lot?.periode_id, collaborateurFocus?.id)
        .then(setRubriquesSansImputation)
        .catch((e: any) => setErreur(e?.message ?? "Erreur lors du chargement des rubriques non imputées."))
        .finally(() => setChargementRSI(false));
    }
  }

  // Les résultats sont spécifiques au collaborateur affiché dans le relevé —
  // changer d'agent (nouveau clic sur un matricule) doit invalider le cache
  // et refermer le panneau plutôt que de garder les rubriques de l'agent
  // précédent.
  useEffect(() => {
    setRubriquesSansImputation(null);
    setAfficherRSI(false);
  }, [collaborateurFocus?.id]);

  // Charge la balance des écritures dès que le lot a des écritures
  // persistées (GENERE/EXPORTE/COMPTABILISE) — pas pour un lot BROUILLON,
  // où rien n'est encore en base (cf. lignesBrutes/desequilibre à la place).
  useEffect(() => {
    if (!lot || lot.statut === "BROUILLON") { setDetailEcritures(null); return; }
    setChargementDetail(true);
    comptaApi.listerEcritures(lot.id, lot.mode_generation, lot.numero_generation)
      .then(setDetailEcritures)
      .catch(() => setDetailEcritures(null))
      .finally(() => setChargementDetail(false));
  }, [lot?.id, lot?.statut, lot?.numero_generation]);

  // ---- Étape 1 : créer/retrouver le lot + contrôler l'effectif ----
  async function handleCreerEtControler() {
    if (!planPaieId || !periodeId) return;
    setEnCours("controle");
    setErreur(null);
    try {
      const [nouveauLot, controleData] = await Promise.all([
        comptaApi.creerLot({ plan_paie_id: planPaieId, periode_id: periodeId, mode_generation: modeGeneration }),
        comptaApi.controlerEffectif(planPaieId, periodeId),
      ]);
      setLot(nouveauLot);
      setControle(controleData);
    } catch (e: any) {
      setErreur(e?.message ?? "Erreur lors de la création du lot.");
    } finally {
      setEnCours(null);
    }
  }

  // ---- Étape 2 : générer les écritures ----
  async function handleGenerer(forcer = false) {
    if (!lot) return;
    setEnCours("generation");
    setErreur(null);
    setDesequilibre(null);
    setLignesBrutes(null);
    try {
      const resultat = await comptaApi.genererLot(lot.id, forcer, undefined);
      if (resultat.desequilibre) {
        // Même normalisation numérique que pour lignes_brutes ci-dessous —
        // ces totaux viennent de la même réponse JSON, même risque de
        // sérialisation Decimal -> chaîne côté backend.
        const desequilibreNormalise = resultat.desequilibre.map((e) => ({
          ...e,
          total_debit: Number(e.total_debit),
          total_credit: Number(e.total_credit),
          collaborateurs: e.collaborateurs.map((c) => ({
            ...c,
            total_debit: Number(c.total_debit),
            total_credit: Number(c.total_credit),
          })),
        }));
        setDesequilibre(desequilibreNormalise);
        // ⚠️ Normalisation numérique à la source : le backend renvoie montant
        // en Decimal, sérialisé en chaîne par FastAPI (cf. GenererLotResultOut,
        // compta_paie.py ligne ~227 : "montant": l.montant sans cast float).
        // Sans ce Number(), tout `reduce((s,l) => s + l.montant, 0)` en aval
        // fait de la concaténation de chaînes au lieu d'une somme (constaté
        // le 05/08 : "0240.3824.0426.15..." au lieu d'un total correct).
        // Corrigé ici une seule fois plutôt que dans chaque usage.
        const lignesNormalisees = (resultat.lignes_brutes ?? []).map((l) => ({ ...l, montant: Number(l.montant) }));
        setLignesBrutes(lignesNormalisees.length ? lignesNormalisees : null);
        setAxeDeplie(null);
        setCompteDeplie(null);
        setRubriqueDepliee(null);
        return;
      }
      const genere = resultat.lot!;
      setLot(genere);
      if (genere.nb_lignes_exclues > 0) {
        comptaApi.listerAnomalies(lot.id).then(setAnomalies).catch(() => {});
        comptaApi.listerAnomaliesParametrage(lot.id).then(setAnomaliesParametrage).catch(() => {});
      }
    } catch (e: any) {
      setErreur(e?.message ?? "Erreur lors de la génération.");
    } finally {
      setEnCours(null);
    }
  }

  // ---- Garde avant l'étape 2 : le lot est-il déjà généré ? ----
  // Un lot BROUILLON (jamais généré) part directement en génération. Un lot
  // déjà GENERE/EXPORTE/COMPTABILISE passe par une confirmation explicite :
  // c'est ce filtre qui manquait et qui permettait de relancer la génération
  // en un clic, produisant des écritures en double (cf. CSV constaté).
  function demanderGeneration(forcer: boolean) {
    if (lot && lot.statut !== "BROUILLON") {
      setConfirmationRegeneration({ forcer });
      return;
    }
    handleGenerer(forcer);
  }

  function confirmerRegeneration() {
    if (!confirmationRegeneration) return;
    const { forcer } = confirmationRegeneration;
    setConfirmationRegeneration(null);
    handleGenerer(forcer);
  }

  // ---- Étape 3 : exporter ----
  async function handleExporter() {
    if (!lot || !formatChoisi) return;
    setEnCours("export");
    setErreur(null);
    try {
      const { blob, filename } = await comptaApi.exporterLot(lot.id, formatChoisi);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      // On relit le lot (GET), on n'en recrée surtout pas un — cf. correctif
      // du 01/08 (l'ancien code appelait creerLot ici, insérant un lot
      // fantôme à chaque export).
      const refresh = await comptaApi.obtenirLot(lot.id).catch(() => null);
      setLot((prev) => refresh ?? (prev ? { ...prev, statut: "EXPORTE" } : prev));
    } catch (e: any) {
      setErreur(e?.message ?? "Erreur lors de l'export.");
    } finally {
      setEnCours(null);
    }
  }

  // Périodes "ouvertes" seulement : date_ouverture renseignée et déjà passée.
  const periodesOuvertes = periodes.filter(
    (p) => p.date_ouverture && new Date(p.date_ouverture) <= new Date()
  );
  const anneesDisponibles = Array.from(new Set(periodesOuvertes.map((p) => p.annee))).sort((a, b) => a - b);
  const periodesDeLAnnee = periodesOuvertes
    .filter((p) => p.annee === anneeSelectionnee)
    .sort((a, b) => (a.numero_periode - b.numero_periode) || (a.mois - b.mois));

  const periodeSelectionnee = periodes.find((p) => p.id === periodeId);
  const peutExporter = lot && (lot.statut === "GENERE" || lot.statut === "EXPORTE" || lot.statut === "COMPTABILISE");
  const equilibre = lot ? (lot.total_debit ?? 0) === (lot.total_credit ?? 0) : true;

  // ── Tri des tableaux plats (clic sur l'en-tête de colonne) ──────────────
  const triEcarts = useTriTable(controle?.ecarts ?? [], {
    matricule: (e) => e.matricule,
    collaborateur: (e) => e.nom_complet,
    motif: (e) => e.motif,
  });
  const triDesequilibre = useTriTable(desequilibre ?? [], {
    axe: (e) => e.libelle_uo ?? e.axe_analytique ?? "",
    debit: (e) => e.total_debit,
    credit: (e) => e.total_credit,
    ecart: (e) => e.total_debit - e.total_credit,
  });
  const lignesAgentFocus = useMemo(
    () => (lignesBrutes && collaborateurFocus ? lignesBrutes.filter((l) => l.collaborateur_id === collaborateurFocus.id) : []),
    [lignesBrutes, collaborateurFocus]
  );
  const triReleve = useTriTable(lignesAgentFocus, {
    compte: (l) => l.compte,
    rubrique: (l) => l.rubrique_paie_code,
    part: (l) => l.part ?? "",
    axe: (l) => l.axe_analytique ?? "",
    debit: (l) => (l.sens === "D" ? l.montant : 0),
    credit: (l) => (l.sens === "C" ? l.montant : 0),
  });
  const triAnomalies = useTriTable(anomalies, {
    rubrique: (a) => a.rubrique_paie_code,
    montant: (a) => a.montant,
    motif: (a) => a.motif,
  });
  const triAnomaliesParametrage = useTriTable(anomaliesParametrage, {
    rubrique: (a) => a.rubrique_paie_code,
    compte: (a) => a.compte,
    sens: (a) => a.sens,
    motif: (a) => a.motif,
  });
  const rubriquesRSIFiltrees = useMemo(() => {
    const q = rechercheRSI.trim().toLowerCase();
    return (rubriquesSansImputation ?? []).filter((r) => {
      if (categorieRSI !== "TOUS" && r.categorie !== categorieRSI) return false;
      if (q && !r.rubrique_paie_code.toLowerCase().includes(q) && !r.libelle.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rubriquesSansImputation, rechercheRSI, categorieRSI]);
  const triRSI = useTriTable(rubriquesRSIFiltrees, {
    code: (r) => r.rubrique_paie_code,
    libelle: (r) => r.libelle,
    categorie: (r) => r.categorie,
    salarial: (r) => r.montant_salarial ?? 0,
    patronal: (r) => r.montant_patronal ?? 0,
  });

  return (
    <div className="px-6 py-4 space-y-3 w-full">
      {/* Repère de navigation */}
      <div className="text-xs text-muted-foreground">
        Paie / Comptabilité / <span className="text-foreground font-medium">Génération des écritures comptables</span>
      </div>

      <div>
        <h1 className="text-xl font-semibold tracking-tight">Génération des écritures comptables</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Génère les écritures débit/crédit à partir des bulletins validés d'un plan et d'une période,
          avec contrôle préalable que l'effectif attendu correspond aux bulletins validés.
        </p>
      </div>

      {erreur && (
        <AlertBanner tone="--destructive">
          <span className="text-sm">{erreur}</span>
        </AlertBanner>
      )}

      {/* ===== Sélection ===== */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Sélection</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Plan de paie</label>
              {chargementPlans ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Select value={planPaieId} onValueChange={setPlanPaieId}>
                  <SelectTrigger><SelectValue placeholder="— Sélectionner —" /></SelectTrigger>
                  <SelectContent>
                    {plans.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.libelle} ({p.frequence})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Année</label>
              <Select
                value={anneeSelectionnee ? String(anneeSelectionnee) : ""}
                onValueChange={(v) => setAnneeSelectionnee(v ? Number(v) : "")}
                disabled={!planPaieId || chargementPeriodes || anneesDisponibles.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={
                    chargementPeriodes ? "Chargement…" : anneesDisponibles.length === 0 && planPaieId ? "Aucune période ouverte" : "— Sélectionner —"
                  } />
                </SelectTrigger>
                <SelectContent>
                  {anneesDisponibles.map((a) => (
                    <SelectItem key={a} value={String(a)}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Période</label>
              <Select value={periodeId} onValueChange={setPeriodeId} disabled={!anneeSelectionnee}>
                <SelectTrigger><SelectValue placeholder="— Sélectionner —" /></SelectTrigger>
                <SelectContent>
                  {periodesDeLAnnee.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      N°{p.numero_periode} — {p.intitule || `Mois ${p.mois}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Granularité de génération</label>
              <div className="flex items-center h-9 px-3 rounded-md border border-border bg-muted/40 text-sm text-foreground">
                {MODE_FIXE.label}
              </div>
            </div>
          </div>

          {periodeSelectionnee && (
            <p className="mt-3 text-xs text-muted-foreground">
              Du {formatDate(periodeSelectionnee.date_debut)} au {formatDate(periodeSelectionnee.date_fin)} —{" "}
              {MODE_FIXE.description}
            </p>
          )}

          <Button
            onClick={handleCreerEtControler}
            disabled={!planPaieId || !periodeId || enCours === "controle" || lot !== null}
            className="mt-4 gap-2"
          >
            {enCours === "controle" ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {lot ? "Lot créé" : "Créer le lot et contrôler l'effectif"}
          </Button>
          {lot && (
            <p className="mt-2 text-xs text-muted-foreground">
              Un lot existe déjà pour cette sélection. Changez de plan, d'année, de période ou de
              granularité pour en créer un autre — ou utilisez « Régénérer » ci-dessous sur celui-ci.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ===== Contrôle d'effectif ===== */}
      {controle && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Contrôle d'effectif</CardTitle>
              <Pill
                tone={controle.ok ? "--success" : "--warning"}
                icon={controle.ok ? CheckCircle2 : AlertTriangle}
                label={controle.ok ? "Contrôle OK" : `${controle.ecarts.length} écart(s)`}
              />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              <KpiCard icon={Users} label="Effectif attendu" value={String(controle.effectif_attendu)} />
              <KpiCard
                icon={UserCheck} label="Bulletins validés/clôturés" value={String(controle.effectif_valide)}
                tone={controle.ok ? "--success" : "--warning"}
              />
              <KpiCard
                icon={UserX} label="Écarts" value={String(controle.ecarts.length)}
                tone={controle.ecarts.length > 0 ? "--destructive" : undefined}
              />
            </div>

            {/* Barre de progression effectif validé / attendu */}
            <div className="mb-4 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${controle.effectif_attendu > 0 ? Math.min(100, (controle.effectif_valide / controle.effectif_attendu) * 100) : 0}%`,
                  background: `hsl(var(${controle.ok ? "--success" : "--warning"}))`,
                }}
              />
            </div>

            {!controle.ok && controle.ecarts.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <ThTriable label="Matricule" colonne="matricule" tri={triEcarts.tri} trierPar={triEcarts.trierPar} />
                      <ThTriable label="Collaborateur" colonne="collaborateur" tri={triEcarts.tri} trierPar={triEcarts.trierPar} />
                      <ThTriable label="Motif" colonne="motif" tri={triEcarts.tri} trierPar={triEcarts.trierPar} />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {triEcarts.lignesTriees.map((e) => (
                      <TableRow key={e.collaborateur_id}>
                        <TableCell className="font-mono">{e.matricule}</TableCell>
                        <TableCell>{e.nom_complet}</TableCell>
                        <TableCell className="text-muted-foreground">{e.motif}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="mt-4 flex items-center gap-3 flex-wrap">
              <Button
                onClick={() => demanderGeneration(false)}
                disabled={enCours === "generation"}
                className="gap-2"
              >
                {enCours === "generation" ? <RefreshCw size={14} className="animate-spin" /> : null}
                {lot && lot.statut !== "BROUILLON" ? "Régénérer les écritures" : "Générer les écritures"}
              </Button>

              {/* 06/08 : le contrôle d'effectif n'est plus bloquant — simple
                  indication, le bouton ci-dessus génère dans tous les cas
                  (le backend force silencieusement côté serveur si l'effectif
                  ne correspond pas, avec un motif automatique tracé sur le lot). */}
              {!controle.ok && (
                <span className="text-xs" style={{ color: "hsl(var(--warning))" }}>
                  Écart d'effectif — la génération continuera malgré tout, tracée comme forcée.
                </span>
              )}
            </div>

            {confirmationRegeneration && lot && (
              <div className="mt-4">
                <AlertBanner tone="--warning">
                  <p className="font-medium">
                    Ce lot a déjà été généré
                    {lot.numero_generation ? ` (génération n° ${lot.numero_generation}` : ""}
                    {lot.numero_generation && lot.genere_le ? `, le ${formatDate(lot.genere_le)})` : lot.numero_generation ? ")" : ""}
                    {!lot.numero_generation && lot.genere_le ? `, le ${formatDate(lot.genere_le)}` : ""}
                    {" par "}
                    {lot.genere_par_nom ? (
                      <>
                        <span className="font-semibold">{lot.genere_par_nom}</span>
                        {lot.genere_par_matricule ? ` (${lot.genere_par_matricule})` : ""}
                        {lot.genere_par ? ` — ${lot.genere_par}` : ""}
                      </>
                    ) : (
                      lot.genere_par || "un utilisateur inconnu"
                    )}
                    .
                  </p>
                  <p className="mt-1">
                    Régénérer va créer une nouvelle génération et remplacer celle utilisée pour les
                    exports et contrôles. Les écritures de la génération précédente restent
                    consultables dans l'historique du lot.
                  </p>
                  {(lot.statut === "EXPORTE" || lot.statut === "COMPTABILISE") && (
                    <p className="mt-1 font-medium">
                      Ce lot a déjà été exporté. Régénérer n'annule pas le fichier déjà téléchargé —
                      pensez à ré-exporter après régénération si le fichier a été transmis au
                      logiciel comptable.
                    </p>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={confirmerRegeneration}
                      disabled={enCours === "generation"}
                      className="gap-1.5"
                      style={{ background: "hsl(var(--warning))", color: "hsl(var(--warning-foreground, 0 0% 100%))" }}
                    >
                      {enCours === "generation" ? <RefreshCw size={12} className="animate-spin" /> : null}
                      Confirmer la régénération
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmationRegeneration(null)} disabled={enCours === "generation"}>
                      Annuler
                    </Button>
                  </div>
                </AlertBanner>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ===== Déséquilibre débit/crédit : ventilation par axe puis collaborateur ===== */}
      {desequilibre && desequilibre.length > 0 && (
        <Card style={{ boxShadow: "inset 0 0 0 1px hsl(var(--destructive) / 0.3)" }}>
          <CardHeader className="pb-1">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} style={{ color: "hsl(var(--destructive))" }} />
              <CardTitle className="text-sm">Écritures déséquilibrées</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground">
              Débit ≠ crédit sur {desequilibre.length} axe{desequilibre.length > 1 ? "s" : ""} analytique{desequilibre.length > 1 ? "s" : ""}.
              Cliquez sur une ligne pour voir les collaborateurs concernés — probablement un compte débit ou crédit
              manquant dans l'imputation d'une rubrique (onglet Comptabilité de la rubrique).
            </p>
          </CardHeader>
          <CardContent className="pt-3">
            {(() => {
              const totalD = desequilibre.reduce((s, e) => s + e.total_debit, 0);
              const totalC = desequilibre.reduce((s, e) => s + e.total_credit, 0);
              return (
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <KpiCard icon={Wallet} label="Total débit" value={formatMoney(totalD)} tone="--info" />
                  <KpiCard icon={Wallet} label="Total crédit" value={formatMoney(totalC)} tone="--accent" />
                  <KpiCard icon={Scale} label="Écart constaté" value={formatMoney(totalD - totalC)} tone="--destructive" />
                </div>
              );
            })()}
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-8" />
                    <ThTriable label="Axe (UO)" colonne="axe" tri={triDesequilibre.tri} trierPar={triDesequilibre.trierPar} />
                    <ThTriable label="Débit" colonne="debit" tri={triDesequilibre.tri} trierPar={triDesequilibre.trierPar} align="right" />
                    <ThTriable label="Crédit" colonne="credit" tri={triDesequilibre.tri} trierPar={triDesequilibre.trierPar} align="right" />
                    <ThTriable label="Écart" colonne="ecart" tri={triDesequilibre.tri} trierPar={triDesequilibre.trierPar} align="right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {triDesequilibre.lignesTriees.map((e) => {
                    const cle = e.axe_analytique ?? "—";
                    const ouvert = axeDeplie === cle;
                    const ecart = e.total_debit - e.total_credit;
                    return (
                      <Fragment key={cle}>
                        <TableRow onClick={() => setAxeDeplie(ouvert ? null : cle)} className="cursor-pointer">
                          <TableCell className="text-muted-foreground">
                            {ouvert ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </TableCell>
                          <TableCell
                            className="font-medium"
                            style={{ paddingLeft: `${Math.max(0, (e.chemin_hierarchique?.length ?? 0) - 1) * 16}px` }}
                          >
                            {e.libelle_uo ? (
                              <div>
                                {(e.chemin_hierarchique?.length ?? 0) > 1 && (
                                  <div className="text-[11px] font-normal text-muted-foreground">
                                    {e.chemin_hierarchique!.slice(0, -1).join(" › ")}
                                  </div>
                                )}
                                <span>{e.code_uo} — {e.libelle_uo}</span>
                              </div>
                            ) : (
                              <span className="italic text-muted-foreground">Sans axe</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right"><MontantDebit value={e.total_debit} formatMoney={formatMoney} /></TableCell>
                          <TableCell className="text-right"><MontantCredit value={e.total_credit} formatMoney={formatMoney} /></TableCell>
                          <TableCell className="text-right font-semibold" style={{ color: "hsl(var(--destructive))" }}>
                            {formatMoney(ecart)}
                          </TableCell>
                        </TableRow>
                        {ouvert && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={5} className="bg-muted/20 p-0">
                              <Table>
                                <TableHeader>
                                  <TableRow className="hover:bg-transparent">
                                    <TableHead className="pl-6">Matricule</TableHead>
                                    <TableHead>Collaborateur</TableHead>
                                    <TableHead className="text-right">Débit</TableHead>
                                    <TableHead className="text-right">Crédit</TableHead>
                                    <TableHead className="text-right pr-6">Écart</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {e.collaborateurs.map((c) => (
                                    <TableRow
                                      key={c.collaborateur_id}
                                      className="cursor-pointer"
                                      onClick={() => setCollaborateurFocus({ id: c.collaborateur_id, matricule: c.matricule, nom: c.nom_complet })}
                                    >
                                      <TableCell className="pl-6 font-mono underline decoration-dotted">{c.matricule}</TableCell>
                                      <TableCell>{c.nom_complet}</TableCell>
                                      <TableCell className="text-right"><MontantDebit value={c.total_debit} formatMoney={formatMoney} /></TableCell>
                                      <TableCell className="text-right"><MontantCredit value={c.total_credit} formatMoney={formatMoney} /></TableCell>
                                      <TableCell className="text-right pr-6 font-medium" style={{ color: "hsl(var(--destructive))" }}>
                                        {formatMoney(c.total_debit - c.total_credit)}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== Relevé complet d'un agent (clic sur un collaborateur dans le
          déséquilibre, ou sur un matricule dans la vue par compte) : toutes
          ses lignes, tous comptes confondus — pas seulement l'axe en écart. ===== */}
      {collaborateurFocus && (!lignesBrutes || lignesBrutes.length === 0) && (
        <AlertBanner tone="--warning">
          <p className="font-medium">Impossible d'afficher le relevé de {collaborateurFocus.nom}.</p>
          <p className="mt-1">
            Le serveur n'a renvoyé aucune ligne détaillée (<code className="font-mono text-xs">lignes_brutes</code> vide ou absent
            de la réponse). Vérifiez dans l'onglet Network que <code className="font-mono text-xs">POST .../generer</code> contient
            bien ce champ — s'il est absent, <code className="font-mono text-xs">GenererLotResultOut</code> (schemas/compta_paie.py)
            ne le déclare probablement pas encore, et FastAPI le filtre silencieusement de la réponse.
          </p>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setCollaborateurFocus(null)}>Fermer</Button>
        </AlertBanner>
      )}

      {collaborateurFocus && lignesBrutes && lignesBrutes.length > 0 && (
        <Card style={{ boxShadow: "inset 0 0 0 1px hsl(var(--accent) / 0.3)" }}>
          <CardHeader className="pb-1">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm">
                  Relevé de {collaborateurFocus.nom} <span className="font-mono text-muted-foreground">({collaborateurFocus.matricule})</span>
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Toutes ses écritures de cette génération, tous comptes confondus.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={toggleRubriquesSansImputation}>
                  Rubriques non imputées
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setCollaborateurFocus(null)}>Fermer</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-3">
            {(() => {
              const totalD = lignesAgentFocus.filter(l => l.sens === "D").reduce((s, l) => s + l.montant, 0);
              const totalC = lignesAgentFocus.filter(l => l.sens === "C").reduce((s, l) => s + l.montant, 0);
              return (
                <>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <KpiCard icon={Wallet} label="Total débit" value={formatMoney(totalD)} tone="--info" />
                    <KpiCard icon={Wallet} label="Total crédit" value={formatMoney(totalC)} tone="--accent" />
                    <KpiCard
                      icon={Scale} label="Écart" value={formatMoney(totalD - totalC)}
                      tone={totalD !== totalC ? "--destructive" : "--success"}
                    />
                  </div>
                  <div className="rounded-lg border border-border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <ThTriable label="Compte" colonne="compte" tri={triReleve.tri} trierPar={triReleve.trierPar} />
                          <ThTriable label="Rubrique" colonne="rubrique" tri={triReleve.tri} trierPar={triReleve.trierPar} />
                          <ThTriable label="Part" colonne="part" tri={triReleve.tri} trierPar={triReleve.trierPar} />
                          <ThTriable label="Axe" colonne="axe" tri={triReleve.tri} trierPar={triReleve.trierPar} />
                          <ThTriable label="Débit" colonne="debit" tri={triReleve.tri} trierPar={triReleve.trierPar} align="right" />
                          <ThTriable label="Crédit" colonne="credit" tri={triReleve.tri} trierPar={triReleve.trierPar} align="right" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {triReleve.lignesTriees.map((l, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono font-medium">{libelleCompte(l.compte)}</TableCell>
                            <TableCell className="font-mono text-xs">{libelleRubrique(l.rubrique_paie_code)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{l.part}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{l.axe_analytique ?? "—"}</TableCell>
                            <TableCell className="text-right">
                              {l.sens === "D" && <MontantDebit value={l.montant} formatMoney={formatMoney} />}
                            </TableCell>
                            <TableCell className="text-right">
                              {l.sens === "C" && <MontantCredit value={l.montant} formatMoney={formatMoney} />}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* ===== Rubriques non imputées : rubriques actives (gain/retenue/
          cotisation) sans ligne dans rubrique_paie_imputation — bouton
          "Rubriques non imputées" du relevé collaborateur ci-dessus. ===== */}
      {afficherRSI && (
        <Card>
          <CardHeader className="pb-1">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm">
                  Rubriques non imputées{collaborateurFocus ? ` — ${collaborateurFocus.nom}` : ""}
                  {collaborateurFocus && <span className="font-mono text-muted-foreground text-xs ml-1">({collaborateurFocus.matricule})</span>}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Rubriques actives (assiette, gain/retenue calculé ou cotisation), sans imputation comptable paramétrée
                  (onglet Comptabilité de la rubrique) — c'est ce qui produit des lignes exclues à la génération.
                  {collaborateurFocus && " Limité aux lignes de ce collaborateur."}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setAfficherRSI(false)}>Fermer</Button>
            </div>
          </CardHeader>
          <CardContent className="pt-3">
            <div className="flex items-center gap-3 mb-3">
              <input
                type="text"
                value={rechercheRSI}
                onChange={(e) => setRechercheRSI(e.target.value)}
                placeholder="Rechercher un code ou un libellé…"
                className="px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border w-64"
              />
              <Select value={categorieRSI} onValueChange={(v) => setCategorieRSI(v as typeof categorieRSI)}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TOUS">Toutes catégories</SelectItem>
                  <SelectItem value="ASS">Assiettes</SelectItem>
                  <SelectItem value="CALC">Gains / retenues calculés</SelectItem>
                  <SelectItem value="COT">Cotisations</SelectItem>
                </SelectContent>
              </Select>
              {rubriquesSansImputation && (
                <span className="text-xs text-muted-foreground">
                  {rubriquesRSIFiltrees.length} / {rubriquesSansImputation.length} rubrique{rubriquesSansImputation.length > 1 ? "s" : ""}
                </span>
              )}
            </div>

            {chargementRSI ? (
              <Skeleton className="h-40 w-full" />
            ) : rubriquesRSIFiltrees.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                {rubriquesSansImputation && rubriquesSansImputation.length > 0
                  ? "Aucune rubrique ne correspond à ce filtre."
                  : "Aucune rubrique sans imputation — le paramétrage comptable est complet."}
              </p>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <ThTriable label="Code" colonne="code" tri={triRSI.tri} trierPar={triRSI.trierPar} />
                      <ThTriable label="Libellé" colonne="libelle" tri={triRSI.tri} trierPar={triRSI.trierPar} />
                      <ThTriable label="Catégorie" colonne="categorie" tri={triRSI.tri} trierPar={triRSI.trierPar} />
                      {lot && <ThTriable label="Montant salarial" colonne="salarial" tri={triRSI.tri} trierPar={triRSI.trierPar} align="right" />}
                      {lot && <ThTriable label="Montant patronal" colonne="patronal" tri={triRSI.tri} trierPar={triRSI.trierPar} align="right" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {triRSI.lignesTriees.map((r) => (
                      <TableRow key={r.rubrique_paie_code}>
                        <TableCell className="font-mono">{r.rubrique_paie_code}</TableCell>
                        <TableCell>{r.libelle}</TableCell>
                        <TableCell>
                          <Pill
                            tone={r.categorie === "CALC" ? "--success" : r.categorie === "ASS" ? "--info" : "--warning"}
                            label={r.categorie === "CALC" ? "Gain/retenue" : r.categorie === "ASS" ? "Assiette" : "Cotisation"}
                          />
                        </TableCell>
                        {lot && (
                          <TableCell className="text-right font-medium" style={{ color: "hsl(var(--info))" }}>
                            {r.montant_salarial ? formatMoney(r.montant_salarial) : "—"}
                          </TableCell>
                        )}
                        {lot && (
                          <TableCell className="text-right font-medium" style={{ color: "hsl(var(--accent))" }}>
                            {r.montant_patronal ? formatMoney(r.montant_patronal) : "—"}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {!lot && rubriquesSansImputation && rubriquesSansImputation.length > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                Aucun lot en cours : liste non filtrée par montant (toutes les rubriques actives sans imputation).
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ===== Écritures groupées compte -> rubrique -> matricule (même en
          déséquilibre : rien n'est persisté, mais on veut quand même voir le
          détail pour repérer où ça cloche) ===== */}
      {lignesBrutes && lignesBrutes.length > 0 && (
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">Écritures par compte</CardTitle>
            <p className="text-xs text-muted-foreground">
              Non persistées (lot resté en brouillon tant que le déséquilibre n'est pas corrigé) —
              groupées par compte, puis par rubrique, puis par collaborateur.
            </p>
          </CardHeader>
          <CardContent className="pt-3">
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-8" />
                    <TableHead>Compte</TableHead>
                    <TableHead className="text-right">Débit</TableHead>
                    <TableHead className="text-right">Crédit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(
                    lignesBrutes.reduce((acc, l) => {
                      (acc[l.compte] ??= []).push(l);
                      return acc;
                    }, {} as Record<string, LigneBrute[]>)
                  )
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([compte, lignesCompte]) => {
                      const totalD = lignesCompte.filter(l => l.sens === "D").reduce((s, l) => s + l.montant, 0);
                      const totalC = lignesCompte.filter(l => l.sens === "C").reduce((s, l) => s + l.montant, 0);
                      const ouvertCompte = compteDeplie === compte;
                      const parRubrique = lignesCompte.reduce((acc, l) => {
                        (acc[l.rubrique_paie_code] ??= []).push(l);
                        return acc;
                      }, {} as Record<string, LigneBrute[]>);

                      return (
                        <Fragment key={compte}>
                          <TableRow
                            onClick={() => { setCompteDeplie(ouvertCompte ? null : compte); setRubriqueDepliee(null); }}
                            className="cursor-pointer"
                          >
                            <TableCell className="text-muted-foreground">
                              {ouvertCompte ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </TableCell>
                            <TableCell className="font-mono font-medium">{libelleCompte(compte)}</TableCell>
                            <TableCell className="text-right"><MontantDebit value={totalD} formatMoney={formatMoney} /></TableCell>
                            <TableCell className="text-right"><MontantCredit value={totalC} formatMoney={formatMoney} /></TableCell>
                          </TableRow>

                          {ouvertCompte && Object.entries(parRubrique).sort(([a], [b]) => a.localeCompare(b)).map(([rubrique, lignesRub]) => {
                            const rTotalD = lignesRub.filter(l => l.sens === "D").reduce((s, l) => s + l.montant, 0);
                            const rTotalC = lignesRub.filter(l => l.sens === "C").reduce((s, l) => s + l.montant, 0);
                            const cleRub = `${compte}::${rubrique}`;
                            const ouvertRub = rubriqueDepliee === cleRub;
                            return (
                              <Fragment key={cleRub}>
                                <TableRow
                                  onClick={() => setRubriqueDepliee(ouvertRub ? null : cleRub)}
                                  className="cursor-pointer bg-muted/10"
                                >
                                  <TableCell />
                                  <TableCell className="pl-6 font-mono text-xs">
                                    <span className="inline-flex items-center gap-1">
                                      {ouvertRub ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                      {libelleRubrique(rubrique)}
                                    </span>
                                  </TableCell>
                                  <TableCell className="text-right text-xs"><MontantDebit value={rTotalD} formatMoney={formatMoney} /></TableCell>
                                  <TableCell className="text-right text-xs"><MontantCredit value={rTotalC} formatMoney={formatMoney} /></TableCell>
                                </TableRow>
                                {ouvertRub && (
                                  <TableRow className="hover:bg-transparent">
                                    <TableCell colSpan={4} className="bg-muted/20 p-0">
                                      <Table>
                                        <TableHeader>
                                          <TableRow className="hover:bg-transparent">
                                            <TableHead className="pl-12">Matricule</TableHead>
                                            <TableHead>Collaborateur</TableHead>
                                            <TableHead className="text-right">Débit</TableHead>
                                            <TableHead className="text-right pr-6">Crédit</TableHead>
                                          </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                          {[...lignesRub].sort((a, b) => (a.nom_complet ?? "").localeCompare(b.nom_complet ?? "")).map((l, i) => (
                                            <TableRow
                                              key={i}
                                              className="cursor-pointer"
                                              onClick={() => l.matricule && setCollaborateurFocus({ id: l.collaborateur_id, matricule: l.matricule, nom: l.nom_complet ?? "" })}
                                            >
                                              <TableCell className="pl-12 font-mono underline decoration-dotted">{l.matricule ?? "—"}</TableCell>
                                              <TableCell>{l.nom_complet ?? "—"}</TableCell>
                                              <TableCell className="text-right">
                                                {l.sens === "D" && <MontantDebit value={l.montant} formatMoney={formatMoney} />}
                                              </TableCell>
                                              <TableCell className="text-right pr-6">
                                                {l.sens === "C" && <MontantCredit value={l.montant} formatMoney={formatMoney} />}
                                              </TableCell>
                                            </TableRow>
                                          ))}
                                        </TableBody>
                                      </Table>
                                    </TableCell>
                                  </TableRow>
                                )}
                              </Fragment>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== Résultat de la génération ===== */}
      {lot && lot.statut !== "BROUILLON" && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Résultat</CardTitle>
              <Pill tone="--accent" icon={Layers} label={lot.statut} />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <KpiCard icon={Wallet} label="Total débit" value={formatMoney(lot.total_debit ?? 0)} tone="--info" />
              <KpiCard icon={Wallet} label="Total crédit" value={formatMoney(lot.total_credit ?? 0)} tone="--accent" />
              <KpiCard
                icon={Scale} label="Équilibre"
                value={equilibre ? "Équilibré" : "Déséquilibré"}
                valueIcon={equilibre ? CheckCircle2 : AlertTriangle}
                tone={equilibre ? "--success" : "--destructive"}
              />
              <KpiCard
                icon={AlertTriangle} label="Lignes exclues" value={String(lot.nb_lignes_exclues)}
                tone={lot.nb_lignes_exclues > 0 ? "--warning" : undefined}
                sub={lot.nb_lignes_exclues > 0 ? "faute d'imputation" : undefined}
              />
            </div>

            {/* Balance des écritures persistées — Compte -> Rubrique ->
                Matricule, en premier après les KPI comme demandé. Même
                composant que celui prévu pour VueComptabilitePage.tsx. */}
            <div className="mb-4">
              {chargementDetail ? (
                <Skeleton className="h-24 w-full" />
              ) : detailEcritures ? (
                <BalanceEcrituresAccordion
                  lignes={detailEcritures.lignes}
                  nominatif={detailEcritures.nominatif}
                  titre="Balance des écritures générées"
                />
              ) : null}
            </div>

            {anomalies.length > 0 && (
              <Accordion type="single" collapsible className="mb-4">
                <AccordionItem value="anomalies" className="rounded-lg border border-border overflow-hidden px-4">
                  <AccordionTrigger className="hover:no-underline text-sm font-semibold">
                    Lignes exclues ({anomalies.length})
                  </AccordionTrigger>
                  <AccordionContent>
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <ThTriable label="Rubrique" colonne="rubrique" tri={triAnomalies.tri} trierPar={triAnomalies.trierPar} />
                          <ThTriable label="Montant" colonne="montant" tri={triAnomalies.tri} trierPar={triAnomalies.trierPar} />
                          <ThTriable label="Motif" colonne="motif" tri={triAnomalies.tri} trierPar={triAnomalies.trierPar} />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {triAnomalies.lignesTriees.map((a, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono">{libelleRubrique(a.rubrique_paie_code)}</TableCell>
                            <TableCell>{formatMoney(a.montant)}</TableCell>
                            <TableCell className="text-muted-foreground">{a.motif}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}

            {anomaliesParametrage.length > 0 && (
              <Accordion type="single" collapsible className="mb-4">
                <AccordionItem
                  value="parametrage"
                  className="rounded-lg overflow-hidden px-4"
                  style={{ boxShadow: "inset 0 0 0 1px hsl(var(--warning) / 0.3)", background: "hsl(var(--warning) / 0.05)" }}
                >
                  <AccordionTrigger className="hover:no-underline text-sm font-semibold" style={{ color: "hsl(var(--warning))" }}>
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle size={12} />
                      Paramétrage à vérifier ({anomaliesParametrage.length}) — n'empêche pas la génération
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent" style={{ background: "hsl(var(--warning) / 0.08)" }}>
                          <ThTriable label="Rubrique" colonne="rubrique" tri={triAnomaliesParametrage.tri} trierPar={triAnomaliesParametrage.trierPar} style={{ color: "hsl(var(--warning))" }} />
                          <ThTriable label="Compte" colonne="compte" tri={triAnomaliesParametrage.tri} trierPar={triAnomaliesParametrage.trierPar} style={{ color: "hsl(var(--warning))" }} />
                          <ThTriable label="Sens" colonne="sens" tri={triAnomaliesParametrage.tri} trierPar={triAnomaliesParametrage.trierPar} style={{ color: "hsl(var(--warning))" }} />
                          <ThTriable label="Motif" colonne="motif" tri={triAnomaliesParametrage.tri} trierPar={triAnomaliesParametrage.trierPar} style={{ color: "hsl(var(--warning))" }} />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {triAnomaliesParametrage.lignesTriees.map((a, i) => (
                          <TableRow key={i} className="hover:bg-transparent">
                            <TableCell className="font-mono">{libelleRubrique(a.rubrique_paie_code)}</TableCell>
                            <TableCell className="font-mono">{libelleCompte(a.compte)}</TableCell>
                            <TableCell>{a.sens}</TableCell>
                            <TableCell className="text-muted-foreground">{a.motif}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}

            {peutExporter && (
              <div className="flex items-center gap-2 pt-3 border-t border-border/60">
                <FileSpreadsheet size={14} className="text-muted-foreground" />
                <Select value={formatChoisi} onValueChange={setFormatChoisi}>
                  <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {formats.map((f) => (
                      <SelectItem key={f.code} value={f.code}>{f.libelle}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={handleExporter} disabled={enCours === "export"} className="gap-2">
                  <Download size={14} /> Exporter
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
