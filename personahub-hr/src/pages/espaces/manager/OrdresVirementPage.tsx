/**
 * OrdresVirementPage.tsx
 * Tableau de bord principal : génération et suivi des ordres de virement
 * (net à payer, retenues tiers, prêts externes, virements ad-hoc).
 * Route suggérée : /virements/ordres
 *
 * Cycle de vie (migration 063) :
 *   BROUILLON -> ENREGISTRE -> EN_CONTROLE -> VALIDE -> GENERE -> TRANSMIS
 *   -> EXECUTE / PARTIEL / REJETE
 * Le fichier SIMT n'est produit qu'au passage VALIDE -> GENERE.
 *
 * Deux modes de génération pour les 3 types classiques :
 *  - MANUEL : un seul compte émetteur choisi explicitement (comportement historique).
 *  - VENTILE : répartition automatique entre plusieurs comptes selon la
 *    banque du bénéficiaire (configuré dans Comptes émetteurs) — peut
 *    produire plusieurs ordres/fichiers en une seule action.
 *
 * Virement ad-hoc : montant et population libres (ex. prime exceptionnelle),
 * sans lien avec bulletin_ligne.
 *
 * ⚠️ Hypothèses à vérifier : identiques aux deux autres écrans du module.
 */

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus,
  Download,
  Send,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Eye,
  MoreHorizontal,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Save,
  ShieldCheck,
  FileCheck2,
  Undo2,
  RefreshCw,
  Wallet,
  UserPlus,
  Trash2,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import CollaborateurPicker from "@/components/CollaborateurPicker";
import {
  virementsApi,
  type OrdreVirement,
  type CompteBancaireEmetteur,
  type AssociationCompteTypeVirement,
  type TypeOrdreVirement,
  type StatutOrdreVirement,
  type ModeGeneration,
  type ControleOrdre,
  type LigneVirement,
  type VirementSyntheseKpi,
} from "@/lib/virementsApi";
import { db } from "@/lib/api";

const LIBELLE_TYPE: Record<TypeOrdreVirement, string> = {
  SALAIRE: "Salaire",
  RETENUE_TIERS: "Retenue tiers",
  PRET_EXTERNE: "Prêt externe",
  AD_HOC: "Ad-hoc",
};

const NATURE_PAR_TYPE: Record<Exclude<TypeOrdreVirement, "AD_HOC">, "34" | "32" | "35"> = {
  SALAIRE: "34",
  RETENUE_TIERS: "32",
  PRET_EXTERNE: "35",
};

const STATUT_CONFIG: Record<StatutOrdreVirement, { libelle: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  BROUILLON: { libelle: "Brouillon", variant: "outline" },
  ENREGISTRE: { libelle: "Enregistré", variant: "outline" },
  EN_CONTROLE: { libelle: "En contrôle", variant: "secondary" },
  VALIDE: { libelle: "Validé", variant: "secondary" },
  GENERE: { libelle: "Généré", variant: "secondary" },
  TRANSMIS: { libelle: "Transmis", variant: "default" },
  EXECUTE: { libelle: "Exécuté", variant: "default" },
  PARTIEL: { libelle: "Partiel", variant: "secondary" },
  REJETE: { libelle: "Rejeté", variant: "destructive" },
};

const LIBELLE_CONTROLE: Record<ControleOrdre["type_controle"], string> = {
  MONTANT_TOTAL: "Montant total",
  RIB_VALIDE: "Validité des RIB",
  DOUBLONS: "Doublons bénéficiaires",
  ECART_PERIODE_PRECEDENTE: "Écart vs période précédente",
  NB_LIGNES_ATTENDU: "Nombre de lignes attendu",
  COMPTE_EMETTEUR_ACTIF: "Compte émetteur actif",
};

// ---------------------------------------------------------------------------
// Tri générique
// ---------------------------------------------------------------------------

type Ordre = "asc" | "desc";

function useTri<T extends Record<string, any>>(donnees: T[]) {
  const [colonne, setColonne] = useState<string | null>(null);
  const [ordre, setOrdre] = useState<Ordre>("asc");

  const trier = (col: string) => {
    if (colonne === col) setOrdre((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setColonne(col);
      setOrdre("asc");
    }
  };

  const donneesTriees = useMemo(() => {
    if (!colonne) return donnees;
    return [...donnees].sort((a, b) => {
      const va = a[colonne];
      const vb = b[colonne];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return ordre === "asc" ? va - vb : vb - va;
      }
      return ordre === "asc"
        ? String(va).localeCompare(String(vb), "fr")
        : String(vb).localeCompare(String(va), "fr");
    });
  }, [donnees, colonne, ordre]);

  return { donneesTriees, colonne, ordre, trier };
}

function EnteteTriable({
  label, col, tri, className,
}: { label: string; col: string; tri: ReturnType<typeof useTri>; className?: string }) {
  const actif = tri.colonne === col;
  return (
    <TableHead className={`cursor-pointer select-none ${className ?? ""}`} onClick={() => tri.trier(col)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {actif ? (
          tri.ordre === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-30" />
        )}
      </span>
    </TableHead>
  );
}

function badgeResultatControle(resultat: ControleOrdre["resultat"]) {
  const style =
    resultat === "OK"
      ? { backgroundColor: "hsl(var(--success, var(--primary)) / 0.15)", color: "hsl(var(--success, var(--primary)))" }
      : resultat === "ALERTE"
      ? { backgroundColor: "hsl(var(--warning) / 0.15)", color: "hsl(var(--warning))" }
      : { backgroundColor: "hsl(var(--destructive) / 0.15)", color: "hsl(var(--destructive))" };
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium" style={style}>
      {resultat}
    </span>
  );
}

const MOIS_FR = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

interface PlanPaie {
  id: string;
  code: string;
  libelle: string;
  actif: boolean;
}

interface CalendrierPaieRow {
  id: string;
  plan_paie_id: string;
  annee: number;
  mois: number;
  numero_periode: number;
  intitule: string | null;
  statut: string | null;
}

export default function OrdresVirementPage() {
  const { toast } = useToast();

  const [plansPaie, setPlansPaie] = useState<PlanPaie[]>([]);
  const [planSelectionne, setPlanSelectionne] = useState<string>("");
  const [collaborateursDuPlan, setCollaborateursDuPlan] = useState<Set<string>>(new Set());
  const [periodesDuPlan, setPeriodesDuPlan] = useState<CalendrierPaieRow[]>([]);
  const [anneeSelectionnee, setAnneeSelectionnee] = useState<number | "">("");
  const [periodeSelectionneeId, setPeriodeSelectionneeId] = useState<string>("");
  const [chargementPeriodes, setChargementPeriodes] = useState(true);

  const [kpi, setKpi] = useState<VirementSyntheseKpi | null>(null);
  const [ordres, setOrdres] = useState<OrdreVirement[]>([]);
  const triOrdres = useTri(ordres);
  const [banques, setBanques] = useState<CompteBancaireEmetteur[]>([]);
  const [associations, setAssociations] = useState<AssociationCompteTypeVirement[]>([]);
  const [chargement, setChargement] = useState(true);

  const [dialogGenererOuvert, setDialogGenererOuvert] = useState(false);
  const [typeAGenerer, setTypeAGenerer] = useState<Exclude<TypeOrdreVirement, "AD_HOC">>("SALAIRE");
  const [modeGeneration, setModeGeneration] = useState<ModeGeneration>("MANUEL");
  const [banqueChoisie, setBanqueChoisie] = useState<string>("");
  const [dateValeur, setDateValeur] = useState(new Date().toISOString().slice(0, 10));

  const [dialogControlesOuvert, setDialogControlesOuvert] = useState(false);
  const [dialogDetailOuvert, setDialogDetailOuvert] = useState(false);
  const [ordreDetail, setOrdreDetail] = useState<OrdreVirement | null>(null);
  const [lignesDetail, setLignesDetail] = useState<LigneVirement[]>([]);
  const [chargementDetail, setChargementDetail] = useState(false);
  const [ordreControle, setOrdreControle] = useState<OrdreVirement | null>(null);
  const [controles, setControles] = useState<ControleOrdre[]>([]);

  const [dialogAdHocOuvert, setDialogAdHocOuvert] = useState(false);
  const [banqueAdHoc, setBanqueAdHoc] = useState("");
  const [dateAdHoc, setDateAdHoc] = useState(new Date().toISOString().slice(0, 10));
  const [libelleAdHoc, setLibelleAdHoc] = useState("");
  const [montantUnique, setMontantUnique] = useState(false);
  const [montantCommun, setMontantCommun] = useState<number>(0);
  const [lignesAdHoc, setLignesAdHoc] = useState<{ collaborateur_id: string; montant: number }[]>([
    { collaborateur_id: "", montant: 0 },
  ]);

  const chargerPlansPaie = async () => {
    try {
      const plans = await db.list<PlanPaie>("plan_paie", { actif: true });
      setPlansPaie(plans);
      if (plans.length > 0) setPlanSelectionne(plans[0].id);
      else {
        toast({ variant: "destructive", title: "Aucun plan de paie actif trouvé" });
        setChargementPeriodes(false);
      }
    } catch {
      toast({ variant: "destructive", title: "Plans de paie non chargés" });
      setChargementPeriodes(false);
    }
  };

  useEffect(() => {
    chargerPlansPaie();
  }, []);

  // Plan sélectionné -> charge ses périodes, sélectionne l'année la plus récente
  useEffect(() => {
    if (!planSelectionne) return;
    (async () => {
      setChargementPeriodes(true);
      try {
        const rows = await db.list<CalendrierPaieRow>("calendrier_paie", { plan_paie_id: planSelectionne, order: "-annee" });
        setPeriodesDuPlan(rows);
        if (rows.length > 0) {
          setAnneeSelectionnee(Math.max(...rows.map((r) => r.annee)));
        } else {
          setAnneeSelectionnee("");
          setPeriodeSelectionneeId("");
          toast({ variant: "destructive", title: "Aucune période configurée pour ce plan de paie" });
        }
      } catch {
        toast({ variant: "destructive", title: "Périodes non chargées" });
      } finally {
        setChargementPeriodes(false);
      }
    })();
  }, [planSelectionne]);

  // Charge la liste des collaborateurs appartenant au plan sélectionné
  // (utilisé pour avertir/filtrer la population du virement ad-hoc)
  useEffect(() => {
    if (!planSelectionne) return;
    (async () => {
      try {
        const rows = await db.list<{ collaborateur_id: string }>("collaborateur_plan_paie", {
          plan_paie_id: planSelectionne, archive: false, select: "collaborateur_id",
        });
        setCollaborateursDuPlan(new Set(rows.map((r) => r.collaborateur_id)));
      } catch {
        toast({ variant: "destructive", title: "Collaborateurs du plan non chargés" });
      }
    })();
  }, [planSelectionne]);

  // Année sélectionnée -> sélectionne une période par défaut (statut "ouverte"
  // si disponible, sinon la plus récente par numéro de période)
  useEffect(() => {
    if (anneeSelectionnee === "" || periodesDuPlan.length === 0) return;
    const periodesAnnee = periodesDuPlan.filter((p) => p.annee === anneeSelectionnee);
    if (periodesAnnee.length === 0) {
      setPeriodeSelectionneeId("");
      return;
    }
    const ouverte = periodesAnnee.find((p) => p.statut && ["ouverte", "en_cours"].includes(p.statut.toLowerCase()));
    const choisie = ouverte ?? [...periodesAnnee].sort((a, b) => b.numero_periode - a.numero_periode)[0];
    setPeriodeSelectionneeId(choisie.id);
  }, [anneeSelectionnee, periodesDuPlan]);

  const anneesDisponibles = useMemo(
    () => [...new Set<number>(periodesDuPlan.map((p) => p.annee))].sort((a, b) => b - a),
    [periodesDuPlan]
  );
  const periodesDeLAnnee = useMemo(
    () => periodesDuPlan.filter((p) => p.annee === anneeSelectionnee).sort((a, b) => a.numero_periode - b.numero_periode),
    [periodesDuPlan, anneeSelectionnee]
  );
  const periodeSelectionnee = useMemo(
    () => periodesDuPlan.find((p) => p.id === periodeSelectionneeId) ?? null,
    [periodesDuPlan, periodeSelectionneeId]
  );

  // Période sélectionnée -> charge KPI/ordres/comptes pour cette période précise
  useEffect(() => {
    if (!periodeSelectionneeId) return;
    chargerDonneesPeriode(periodeSelectionneeId);
  }, [periodeSelectionneeId]);

  const chargerDonneesPeriode = async (periodeId: string) => {
    setChargement(true);
    const [resKpi, resOrdres, resBanques, resAssociations] = await Promise.allSettled([
      virementsApi.getKpiPeriode(periodeId),
      virementsApi.getOrdresVirement({ periode_id: periodeId }),
      db.list<CompteBancaireEmetteur>("societe_comptes_bancaires", { actif: true }),
      db.list<AssociationCompteTypeVirement>("societe_compte_bancaire_type_virement"),
    ]);
    if (resKpi.status === "fulfilled") setKpi(resKpi.value);
    else toast({ variant: "destructive", title: "KPI non chargés" });
    if (resOrdres.status === "fulfilled") setOrdres(resOrdres.value);
    else toast({ variant: "destructive", title: "Ordres de virement non chargés" });
    if (resBanques.status === "fulfilled") {
      setBanques(resBanques.value.filter((b) => b.code_simt_effectif && b.rib && b.raison_sociale_emetteur));
    } else {
      toast({ variant: "destructive", title: "Comptes émetteurs non chargés" });
    }
    if (resAssociations.status === "fulfilled") setAssociations(resAssociations.value);
    else toast({ variant: "destructive", title: "Associations compte/virement non chargées" });
    setChargement(false);
  };

  // Recharge le tableau des ordres (utilisé après chaque action) sans repasser par tout le cascade plan/année
  const chargerDonnees = () => {
    if (periodeSelectionneeId) chargerDonneesPeriode(periodeSelectionneeId);
  };

  const formatMontant = (montant: number) =>
    new Intl.NumberFormat("fr-MA", { minimumFractionDigits: 2 }).format(montant) + " MAD";

  // ---- Génération (manuel / ventilé) ----
  const ouvrirGeneration = (type: Exclude<TypeOrdreVirement, "AD_HOC">) => {
    setTypeAGenerer(type);
    setModeGeneration("MANUEL");
    setBanqueChoisie("");
    setDialogGenererOuvert(true);
  };

  const confirmerGeneration = async () => {
    if (modeGeneration === "MANUEL" && !banqueChoisie) {
      toast({ variant: "destructive", title: "Sélectionnez une banque émettrice" });
      return;
    }
    if (!periodeSelectionneeId) {
      toast({ variant: "destructive", title: "Période introuvable" });
      return;
    }
    try {
      const resultats = await virementsApi.genererOrdreVirement({
        type: typeAGenerer,
        periode_id: periodeSelectionneeId,
        mode: modeGeneration,
        banque_emettrice_id: modeGeneration === "MANUEL" ? banqueChoisie : undefined,
        date_valeur: dateValeur,
      });
      toast({ title: `${resultats.length} ordre(s) généré(s) en brouillon` });
      setDialogGenererOuvert(false);
      chargerDonnees();
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Échec de la génération",
        description: e?.message ?? "Vérifiez la configuration des comptes émetteurs.",
      });
    }
  };

  // ---- Ad-hoc ----
  const ouvrirAdHoc = () => {
    setBanqueAdHoc("");
    setLibelleAdHoc("");
    setMontantUnique(false);
    setMontantCommun(0);
    setLignesAdHoc([{ collaborateur_id: "", montant: 0 }]);
    setDialogAdHocOuvert(true);
  };

  const ajouterLigneAdHoc = () => setLignesAdHoc((l) => [...l, { collaborateur_id: "", montant: montantUnique ? montantCommun : 0 }]);
  const retirerLigneAdHoc = (index: number) => setLignesAdHoc((l) => l.filter((_, i) => i !== index));
  const modifierLigneAdHoc = (index: number, champ: "collaborateur_id" | "montant", valeur: string | number) =>
    setLignesAdHoc((l) => l.map((ligne, i) => (i === index ? { ...ligne, [champ]: valeur } : ligne)));

  const confirmerAdHoc = async () => {
    const lignesValides = lignesAdHoc
      .map((l) => ({ collaborateur_id: l.collaborateur_id, montant: montantUnique ? montantCommun : l.montant }))
      .filter((l) => l.collaborateur_id && l.montant > 0);
    if (!banqueAdHoc || !libelleAdHoc || lignesValides.length === 0) {
      toast({ variant: "destructive", title: "Champs incomplets", description: "Compte, motif et au moins une ligne valide sont requis." });
      return;
    }
    try {
      await virementsApi.genererOrdreAdHoc({
        banque_emettrice_id: banqueAdHoc, date_valeur: dateAdHoc, libelle_motif: libelleAdHoc,
        plan_paie_id: planSelectionne || undefined, lignes: lignesValides,
      });
      toast({ title: "Virement ad-hoc créé en brouillon" });
      setDialogAdHocOuvert(false);
      chargerDonnees();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Échec de la création", description: e?.message });
    }
  };

  // ---- Actions sur un ordre existant ----
  const regenererLignes = async (ordre: OrdreVirement) => {
    try {
      await virementsApi.regenererLignesBrouillon(ordre.id);
      toast({ title: "Lignes régénérées depuis la source" });
      chargerDonnees();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Échec de la régénération", description: e?.message });
    }
  };

  const enregistrer = async (ordre: OrdreVirement) => {
    try {
      await virementsApi.enregistrerOrdre(ordre.id);
      toast({ title: "Ordre enregistré" });
      chargerDonnees();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Échec de l'enregistrement", description: e?.message });
    }
  };

  const voirDetail = async (ordre: OrdreVirement) => {
    setOrdreDetail(ordre);
    setDialogDetailOuvert(true);
    setChargementDetail(true);
    try {
      const lignes = await virementsApi.getLignesOrdreVirement(ordre.id);
      setLignesDetail(lignes);
    } catch {
      toast({ variant: "destructive", title: "Détail non chargé" });
    } finally {
      setChargementDetail(false);
    }
  };

  const lancerControle = async (ordre: OrdreVirement) => {
    try {
      const resultats = await virementsApi.controlerOrdre(ordre.id);
      setOrdreControle(ordre);
      setControles(resultats);
      setDialogControlesOuvert(true);
      chargerDonnees();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Échec du contrôle", description: e?.message });
    }
  };

  const voirControles = async (ordre: OrdreVirement) => {
    try {
      const resultats = await virementsApi.getControlesOrdre(ordre.id);
      setOrdreControle(ordre);
      setControles(resultats);
      setDialogControlesOuvert(true);
    } catch {
      toast({ variant: "destructive", title: "Contrôles non disponibles" });
    }
  };

  const valider = async (ordre: OrdreVirement, forcerAlertes = false) => {
    try {
      await virementsApi.validerOrdre(ordre.id, forcerAlertes);
      toast({ title: "Ordre validé" });
      setDialogControlesOuvert(false);
      chargerDonnees();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Échec de la validation", description: e?.message });
    }
  };

  const genererFichier = async (ordre: OrdreVirement) => {
    try {
      await virementsApi.genererFichierOrdre(ordre.id);
      toast({ title: "Fichier SIMT généré" });
      chargerDonnees();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Échec de la génération du fichier", description: e?.message });
    }
  };

  const revenirEnArriere = async (ordre: OrdreVirement) => {
    try {
      await virementsApi.revenirEnArriere(ordre.id);
      toast({ title: "Retour à l'étape précédente" });
      chargerDonnees();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Échec du retour en arrière", description: e?.message });
    }
  };

  const telecharger = async (ordre: OrdreVirement) => {
    try {
      const blob = await virementsApi.telechargerFichierSimt(ordre.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${ordre.reference_lot}.txt`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      toast({ variant: "destructive", title: "Téléchargement impossible" });
    }
  };

  const marquerTransmis = async (ordre: OrdreVirement) => {
    try {
      await virementsApi.marquerTransmis(ordre.id);
      toast({ title: "Ordre marqué transmis" });
      chargerDonnees();
    } catch {
      toast({ variant: "destructive", title: "Échec de la mise à jour" });
    }
  };

  const marquerExecute = async (ordre: OrdreVirement) => {
    try {
      await virementsApi.marquerExecute(ordre.id);
      toast({ title: "Ordre marqué exécuté" });
      chargerDonnees();
    } catch {
      toast({ variant: "destructive", title: "Échec de la mise à jour" });
    }
  };

  const regenererApresRejet = async (ordre: OrdreVirement) => {
    try {
      await virementsApi.regenererOrdreVirement(ordre.id);
      toast({ title: "Ordre régénéré" });
      chargerDonnees();
    } catch {
      toast({ variant: "destructive", title: "Échec de la régénération" });
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Ordres de virement</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={ouvrirAdHoc}>
            <UserPlus className="mr-2 h-4 w-4" />
            Virement ad-hoc
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Générer un ordre de virement
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => ouvrirGeneration("SALAIRE")}>Net à payer (salaires)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => ouvrirGeneration("RETENUE_TIERS")}>Retenues tiers (oppositions, pensions)</DropdownMenuItem>

              <DropdownMenuItem onClick={() => ouvrirGeneration("PRET_EXTERNE")}>Remboursements prêts externes</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Sélecteur Plan de paie / Année / Période */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
        <div className="min-w-[220px]">
          <Label className="text-xs text-muted-foreground">Plan de paie</Label>
          <Select value={planSelectionne} onValueChange={setPlanSelectionne}>
            <SelectTrigger><SelectValue placeholder="Sélectionner un plan" /></SelectTrigger>
            <SelectContent>
              {plansPaie.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.libelle}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[120px]">
          <Label className="text-xs text-muted-foreground">Année</Label>
          <Select value={anneeSelectionnee === "" ? "" : String(anneeSelectionnee)} onValueChange={(v) => setAnneeSelectionnee(Number(v))}>
            <SelectTrigger><SelectValue placeholder="Année" /></SelectTrigger>
            <SelectContent>
              {anneesDisponibles.map((a) => (
                <SelectItem key={a} value={String(a)}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[220px]">
          <Label className="text-xs text-muted-foreground">Période</Label>
          <Select value={periodeSelectionneeId} onValueChange={setPeriodeSelectionneeId}>
            <SelectTrigger><SelectValue placeholder="Période" /></SelectTrigger>
            <SelectContent>
              {periodesDeLAnnee.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.intitule ?? `${MOIS_FR[p.mois]} ${p.annee}`}
                  {p.statut ? ` — ${p.statut}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {chargementPeriodes && <p className="text-xs text-muted-foreground">Chargement des périodes…</p>}
      </div>

      {/* Cartes KPI */}
      <div className="grid grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Net à payer</p>
            <p className="text-2xl font-medium">{kpi ? formatMontant(kpi.net_a_payer.montant) : "—"}</p>
            <p className="text-xs text-muted-foreground">{kpi ? `${kpi.net_a_payer.nb_collaborateurs} collaborateurs` : ""}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Retenues tiers</p>
            <p className="text-2xl font-medium">{kpi ? formatMontant(kpi.retenues_tiers.montant) : "—"}</p>
            <p className="text-xs text-muted-foreground">{kpi ? `${kpi.retenues_tiers.nb_dossiers} dossiers actifs` : ""}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Prêts externes</p>
            <p className="text-2xl font-medium">{kpi ? formatMontant(kpi.prets_externes.montant) : "—"}</p>
            <p className="text-xs text-muted-foreground">{kpi ? `${kpi.prets_externes.nb_echeances} échéances` : ""}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Rejets à traiter</p>
            <p className="text-2xl font-medium text-destructive">{kpi ? kpi.rejets_a_traiter : "—"}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tableau des ordres */}
      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <EnteteTriable label="Type" col="type" tri={triOrdres} />
                <EnteteTriable label="Banque émettrice" col="banque_emettrice_libelle" tri={triOrdres} />
                <EnteteTriable label="Référence lot" col="reference_lot" tri={triOrdres} />
                <EnteteTriable label="Lignes" col="nb_lignes" tri={triOrdres} className="text-right" />
                <EnteteTriable label="Montant" col="montant_total" tri={triOrdres} className="text-right" />
                <EnteteTriable label="Statut" col="statut" tri={triOrdres} />
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {chargement && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Chargement...</TableCell></TableRow>
              )}
              {!chargement && ordres.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Aucun ordre de virement généré pour cette période.</TableCell></TableRow>
              )}
              {triOrdres.donneesTriees.map((ordre) => (
                <TableRow key={ordre.id}>
                  <TableCell><Badge variant="outline">{LIBELLE_TYPE[ordre.type]}</Badge></TableCell>
                  <TableCell>{ordre.banque_emettrice_libelle}</TableCell>
                  <TableCell className="font-mono text-xs">{ordre.reference_lot}</TableCell>
                  <TableCell className="text-right">{ordre.nb_lignes}</TableCell>
                  <TableCell className="text-right font-medium">{formatMontant(ordre.montant_total)}</TableCell>
                  <TableCell><Badge variant={STATUT_CONFIG[ordre.statut].variant}>{STATUT_CONFIG[ordre.statut].libelle}</Badge></TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => voirDetail(ordre)}><Eye className="mr-2 h-4 w-4" />Voir le détail</DropdownMenuItem>

                        {ordre.statut === "BROUILLON" && ordre.type !== "AD_HOC" && (
                          <DropdownMenuItem onClick={() => regenererLignes(ordre)}>
                            <RefreshCw className="mr-2 h-4 w-4" />Régénérer les lignes depuis la source
                          </DropdownMenuItem>
                        )}
                        {ordre.statut === "BROUILLON" && (
                          <DropdownMenuItem onClick={() => enregistrer(ordre)}>
                            <Save className="mr-2 h-4 w-4" />Enregistrer
                          </DropdownMenuItem>
                        )}

                        {ordre.statut === "ENREGISTRE" && (
                          <>
                            <DropdownMenuItem onClick={() => lancerControle(ordre)}>
                              <ShieldCheck className="mr-2 h-4 w-4" />Passer en contrôle
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => revenirEnArriere(ordre)}>
                              <Undo2 className="mr-2 h-4 w-4" />Revenir en brouillon
                            </DropdownMenuItem>
                          </>
                        )}

                        {ordre.statut === "EN_CONTROLE" && (
                          <>
                            <DropdownMenuItem onClick={() => voirControles(ordre)}>
                              <ShieldCheck className="mr-2 h-4 w-4" />Voir les rapprochements / valider
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => revenirEnArriere(ordre)}>
                              <Undo2 className="mr-2 h-4 w-4" />Revenir en enregistré
                            </DropdownMenuItem>
                          </>
                        )}

                        {ordre.statut === "VALIDE" && (
                          <>
                            <DropdownMenuItem onClick={() => genererFichier(ordre)}>
                              <FileCheck2 className="mr-2 h-4 w-4" />Générer le support magnétique
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => revenirEnArriere(ordre)}>
                              <Undo2 className="mr-2 h-4 w-4" />Revenir en contrôle
                            </DropdownMenuItem>
                          </>
                        )}

                        {ordre.statut === "GENERE" && (
                          <>
                            <DropdownMenuItem onClick={() => telecharger(ordre)}>
                              <Download className="mr-2 h-4 w-4" />Télécharger fichier SIMT
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => marquerTransmis(ordre)}>
                              <Send className="mr-2 h-4 w-4" />Marquer transmis
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => revenirEnArriere(ordre)}>
                              <Undo2 className="mr-2 h-4 w-4" />Revenir à validé (pour régénérer le fichier)
                            </DropdownMenuItem>
                          </>
                        )}

                        {ordre.statut === "TRANSMIS" && (
                          <>
                            <DropdownMenuItem onClick={() => marquerExecute(ordre)}>
                              <CheckCircle2 className="mr-2 h-4 w-4" />Marquer exécuté
                            </DropdownMenuItem>
                            <DropdownMenuItem><XCircle className="mr-2 h-4 w-4" />Signaler un rejet</DropdownMenuItem>
                          </>
                        )}

                        {(ordre.statut === "REJETE" || ordre.statut === "PARTIEL") && (
                          <DropdownMenuItem onClick={() => regenererApresRejet(ordre)}>
                            <RotateCcw className="mr-2 h-4 w-4" />Régénérer
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog génération */}
      <Dialog open={dialogGenererOuvert} onOpenChange={setDialogGenererOuvert}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Générer un ordre de virement — {LIBELLE_TYPE[typeAGenerer]}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 rounded-md border bg-muted/30 p-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Plan de paie</p>
                <p className="font-medium">{plansPaie.find((p) => p.id === planSelectionne)?.libelle ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Année</p>
                <p className="font-medium">{anneeSelectionnee || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Période</p>
                <p className="font-medium">
                  {periodeSelectionnee?.intitule ?? (periodeSelectionnee ? `${MOIS_FR[periodeSelectionnee.mois]} ${periodeSelectionnee.annee}` : "—")}
                </p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Nature d'opération SIMT : {NATURE_PAR_TYPE[typeAGenerer]} (
              {typeAGenerer === "SALAIRE" ? "Salaires" : typeAGenerer === "RETENUE_TIERS" ? "Standard" : "Fournisseurs"})
            </p>

            <div>
              <Label>Mode de génération</Label>
              <div className="mt-2 flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={modeGeneration === "MANUEL"} onChange={() => setModeGeneration("MANUEL")} />
                  Manuel (un seul compte émetteur)
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={modeGeneration === "VENTILE"} onChange={() => setModeGeneration("VENTILE")} />
                  Ventilé (auto, selon la banque du bénéficiaire)
                </label>
              </div>
            </div>

            {modeGeneration === "MANUEL" ? (
              <div>
                <Label>Banque émettrice</Label>
                <Select value={banqueChoisie} onValueChange={setBanqueChoisie}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner un compte émetteur" /></SelectTrigger>
                  <SelectContent>
                    {banques
                      .filter((b) => associations.some((a) => a.compte_bancaire_id === b.id && a.type_virement === typeAGenerer))
                      .map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.code_banque} — {b.numero_compte}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <p className="rounded-md border p-3 text-xs text-muted-foreground">
                Le système répartira automatiquement les lignes entre les comptes émetteurs
                autorisés pour ce type, selon la banque de chaque bénéficiaire (configuration dans
                Comptes émetteurs). Une banque non couverte par aucun compte bloquera la génération
                pour les lignes concernées.
              </p>
            )}

            <div>
              <Label>Date de valeur</Label>
              <Input type="date" value={dateValeur} onChange={(e) => setDateValeur(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogGenererOuvert(false)}>Annuler</Button>
            <Button onClick={confirmerGeneration}>Générer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog virement ad-hoc */}
      <Dialog open={dialogAdHocOuvert} onOpenChange={setDialogAdHocOuvert}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nouveau virement ad-hoc</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p className="text-xs text-muted-foreground">Plan de paie (population éligible)</p>
              <p className="font-medium">{plansPaie.find((p) => p.id === planSelectionne)?.libelle ?? "—"}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Compte émetteur</Label>
                <Select value={banqueAdHoc} onValueChange={setBanqueAdHoc}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner un compte" /></SelectTrigger>
                  <SelectContent>
                    {banques
                      .filter((b) => associations.some((a) => a.compte_bancaire_id === b.id && a.type_virement === "AD_HOC"))
                      .map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.code_banque} — {b.numero_compte}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Date de valeur</Label>
                <Input type="date" value={dateAdHoc} onChange={(e) => setDateAdHoc(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Motif (ligne du fichier SIMT, 35 car. max)</Label>
              <Input maxLength={35} value={libelleAdHoc} onChange={(e) => setLibelleAdHoc(e.target.value.toUpperCase())} placeholder="ex. PRIME EXCEPTIONNELLE JUILLET 2026" />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={montantUnique} onCheckedChange={(v) => setMontantUnique(!!v)} />
              Montant identique pour toute la population
            </label>
            {montantUnique && (
              <div>
                <Label>Montant (MAD)</Label>
                <Input type="number" min={0} value={montantCommun} onChange={(e) => setMontantCommun(Number(e.target.value))} />
              </div>
            )}

            <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Population</Label>
                <Button variant="outline" size="sm" onClick={ajouterLigneAdHoc}>
                  <Plus className="mr-1 h-3.5 w-3.5" />Ajouter
                </Button>
              </div>
              {lignesAdHoc.map((ligne, index) => {
                const horsPlan = ligne.collaborateur_id && !collaborateursDuPlan.has(ligne.collaborateur_id);
                return (
                  <div key={index}>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <CollaborateurPicker
                          value={ligne.collaborateur_id}
                          onChange={(id: string) => modifierLigneAdHoc(index, "collaborateur_id", id)}
                        />
                      </div>
                      {!montantUnique && (
                        <Input
                          type="number"
                          min={0}
                          className="w-32"
                          placeholder="Montant"
                          value={ligne.montant || ""}
                          onChange={(e) => modifierLigneAdHoc(index, "montant", Number(e.target.value))}
                        />
                      )}
                      <Button variant="ghost" size="icon" onClick={() => retirerLigneAdHoc(index)}>
                        <Trash2 className="h-4 w-4" style={{ color: "hsl(var(--destructive))" }} />
                      </Button>
                    </div>
                    {horsPlan && (
                      <p className="mt-1 text-xs" style={{ color: "hsl(var(--destructive))" }}>
                        Ce collaborateur n'appartient pas au plan de paie sélectionné — sera rejeté à la création.
                      </p>
                    )}
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground">
                Import Excel (matricule + montant) non encore disponible ici — utilisez la sélection
                manuelle en attendant.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogAdHocOuvert(false)}>Annuler</Button>
            <Button onClick={confirmerAdHoc}>Créer en brouillon</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog détail des lignes */}
      <Dialog open={dialogDetailOuvert} onOpenChange={setDialogDetailOuvert}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Détail — {ordreDetail?.reference_lot}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bénéficiaire</TableHead>
                  <TableHead>RIB</TableHead>
                  <TableHead>Motif</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chargementDetail && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Chargement...</TableCell></TableRow>
                )}
                {!chargementDetail && lignesDetail.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Aucune ligne.</TableCell></TableRow>
                )}
                {lignesDetail.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.nom_beneficiaire_snapshot}</TableCell>
                    <TableCell className="font-mono text-xs">{l.rib_beneficiaire_snapshot}</TableCell>
                    <TableCell className="text-xs">{l.libelle_motif}</TableCell>
                    <TableCell className="text-right">{formatMontant(l.montant)}</TableCell>
                    <TableCell>
                      <Badge variant={l.statut_ligne === "REJETEE" ? "destructive" : l.statut_ligne === "EXECUTEE" ? "default" : "outline"}>
                        {l.statut_ligne}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogDetailOuvert(false)}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog rapprochements / validation */}
      <Dialog open={dialogControlesOuvert} onOpenChange={setDialogControlesOuvert}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Rapprochements — {ordreControle?.reference_lot}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {controles.map((c, i) => (
              <div key={i} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <div>
                  <p className="font-medium">{LIBELLE_CONTROLE[c.type_controle]}</p>
                  <p className="text-xs text-muted-foreground">{c.message}</p>
                </div>
                {badgeResultatControle(c.resultat)}
              </div>
            ))}
            {controles.some((c) => c.resultat === "ERREUR") && (
              <p className="text-xs" style={{ color: "hsl(var(--destructive))" }}>
                Au moins une erreur bloque la validation — corrigez puis relancez le contrôle.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogControlesOuvert(false)}>Fermer</Button>
            {ordreControle && ordreControle.statut === "EN_CONTROLE" && (
              <Button
                disabled={controles.some((c) => c.resultat === "ERREUR")}
                onClick={() => valider(ordreControle, controles.some((c) => c.resultat === "ALERTE"))}
              >
                Valider
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
