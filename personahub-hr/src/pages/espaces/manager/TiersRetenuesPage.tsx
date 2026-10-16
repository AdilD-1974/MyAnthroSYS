/**
 * TiersRetenuesPage.tsx
 * Gestion des tiers payeurs, dossiers de retenue, types de retenue et types
 * de tiers. Route suggérée : /virements/tiers-retenues
 *
 * Nouveautés de cette version :
 *  - Tri cliquable sur toutes les colonnes de toutes les listes.
 *  - Icônes d'action (modifier/archiver/réactiver) en couleurs dynamiques
 *    du thème (hsl(var(--primary)), hsl(var(--destructive)), hsl(var(--success))).
 *  - "Supprimer" un type de retenue/de tiers = archivage (actif=false),
 *    jamais de DELETE réel.
 *  - Libellé de rubrique affiché via embed PostgREST (rubrique_paie!inner)
 *    sur /db/ref_type_retenue_source.
 *  - Champ "date de fin" exposé en création et modification de dossier.
 *
 * ⚠️ Hypothèses à vérifier :
 *  - La syntaxe d'embed `select: "*,rubrique_paie!inner(libelle)"` sur
 *    l'endpoint générique /db/ suppose qu'il détecte automatiquement la FK
 *    ref_type_retenue_source.rubrique_paie_code -> rubrique_paie.code,
 *    comme observé ailleurs dans vos logs (collaborateurs!inner(...)). Si
 *    l'embed ne fonctionne pas pour une FK sur clé texte (pas uuid), il
 *    faudra revenir à un chargement séparé + jointure client-side.
 */

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Pencil,
  Copy,
  PauseCircle,
  Archive,
  RotateCcw,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  User,
  Tag,
  Landmark,
  Hash,
  CalendarDays,
  Users,
  ListChecks,
  Settings2,
  ShieldAlert,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import CollaborateurPicker from "@/components/CollaborateurPicker";
import { db } from "@/lib/api";
import {
  virementsApi,
  type TiersPayeur,
  type RetenueTiers,
  type TypeTiersPayeur,
  type TypeRetenueSource,
} from "@/lib/virementsApi";

// ---------------------------------------------------------------------------
// Tri générique réutilisé par toutes les listes de cet écran
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
  label,
  col,
  tri,
  className,
}: {
  label: string;
  col: string;
  tri: ReturnType<typeof useTri>;
  className?: string;
}) {
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

// Couleurs d'icônes dynamiques (thème), jamais codées en dur
const STYLE_ICONE_EDIT = { color: "hsl(var(--primary))" };
const STYLE_ICONE_DUPLIQUER = { color: "hsl(var(--secondary))" };
const STYLE_ICONE_ARCHIVE = { color: "hsl(var(--destructive))" };
const STYLE_ICONE_REACTIVER = { color: "hsl(var(--success, var(--primary)))" };

// ---------------------------------------------------------------------------

const VIDE_TIERS: Omit<TiersPayeur, "id"> = {
  type_tiers_payeur_code: "",
  nom: "",
  rib: "",
  reference_externe: "",
  actif: true,
};

export default function TiersRetenuesPage() {
  const { toast } = useToast();
  const [tiers, setTiers] = useState<TiersPayeur[]>([]);
  const [dossiers, setDossiers] = useState<RetenueTiers[]>([]);
  const [typesRetenue, setTypesRetenue] = useState<TypeRetenueSource[]>([]);
  const [typesTiers, setTypesTiers] = useState<TypeTiersPayeur[]>([]);
  const [chargement, setChargement] = useState(true);

  const [dialogTiersOuvert, setDialogTiersOuvert] = useState(false);
  const [formTiers, setFormTiers] = useState(VIDE_TIERS);

  const [dialogTypeTiersOuvert, setDialogTypeTiersOuvert] = useState(false);
  const [typeTiersEnEdition, setTypeTiersEnEdition] = useState<TypeTiersPayeur | null>(null);
  const [formTypeTiers, setFormTypeTiers] = useState({ code: "", libelle: "" });

  const [dialogDossierOuvert, setDialogDossierOuvert] = useState(false);
  const [dossierEnEdition, setDossierEnEdition] = useState<RetenueTiers | null>(null);
  const [dialogTypeOuvert, setDialogTypeOuvert] = useState(false);
  const [typeEnEdition, setTypeEnEdition] = useState<TypeRetenueSource | null>(null);
  const [rubriquesRetenue, setRubriquesRetenue] = useState<{ code: string; libelle: string }[]>([]);
  const [formType, setFormType] = useState({
    code: "",
    libelle: "",
    rubrique_paie_code: "",
    priorite_defaut: 100,
  });
  const [formDossier, setFormDossier] = useState<{
    collaborateur_id: string;
    tiers_payeur_id: string;
    type_retenue_source_code: string;
    priorite: number;
    reference_dossier: string;
    date_debut: string;
    date_fin: string;
  }>({
    collaborateur_id: "",
    tiers_payeur_id: "",
    type_retenue_source_code: "",
    priorite: 100,
    reference_dossier: "",
    date_debut: new Date().toISOString().slice(0, 10),
    date_fin: "",
  });

  const chargerDonnees = async () => {
    setChargement(true);
    const [resTiers, resDossiers, resTypes, resTypesTiers, resRubriques] = await Promise.allSettled([
      db.list<TiersPayeur>("tiers_payeur"),
      virementsApi.getRetenuesTiers(),
      db.list<TypeRetenueSource & { rubrique_paie?: { libelle: string } }>("ref_type_retenue_source", {
        select: "*,rubrique_paie!inner(libelle)",
      }),
      db.list<TypeTiersPayeur>("ref_type_tiers_payeur"),
      db.list<{ code: string; libelle: string }>("rubrique_paie", {
        select: "code,libelle",
        archive: false,
        traiter: true,
        code_famille: "RET",
      }),
    ]);

    if (resTiers.status === "fulfilled") setTiers(resTiers.value);
    else toast({ variant: "destructive", title: "Tiers payeurs non chargés" });

    if (resDossiers.status === "fulfilled") setDossiers(resDossiers.value);
    else toast({ variant: "destructive", title: "Dossiers de retenue non chargés" });

    if (resTypes.status === "fulfilled") {
      setTypesRetenue(
        resTypes.value.map((t) => ({ ...t, rubrique_paie_libelle: t.rubrique_paie?.libelle ?? t.rubrique_paie_libelle }))
      );
    } else {
      toast({ variant: "destructive", title: "Types de retenue non chargés" });
    }

    if (resTypesTiers.status === "fulfilled") setTypesTiers(resTypesTiers.value);
    else toast({ variant: "destructive", title: "Types de tiers non chargés" });

    if (resRubriques.status === "fulfilled") setRubriquesRetenue(resRubriques.value);
    else toast({ variant: "destructive", title: "Rubriques non chargées" });

    setChargement(false);
  };

  useEffect(() => {
    chargerDonnees();
  }, []);

  const libelleTypeTiers = (code: string) => typesTiers.find((t) => t.code === code)?.libelle ?? code;

  // ---- Tiers payeurs ----
  const enregistrerTiers = async () => {
    try {
      await db.create("tiers_payeur", formTiers);
      toast({ title: "Tiers payeur créé" });
      setDialogTiersOuvert(false);
      setFormTiers(VIDE_TIERS);
      chargerDonnees();
    } catch {
      toast({ variant: "destructive", title: "Échec de la création" });
    }
  };

  const dupliquerTiers = (t: TiersPayeur) => {
    setFormTiers({
      type_tiers_payeur_code: t.type_tiers_payeur_code,
      nom: `${t.nom} (copie)`,
      rib: "",
      reference_externe: "",
      actif: true,
    });
    setDialogTiersOuvert(true);
  };

  const archiverTiers = async (t: TiersPayeur) => {
    try {
      await db.update("tiers_payeur", { id: t.id }, { actif: !t.actif });
      toast({ title: t.actif ? "Tiers archivé" : "Tiers réactivé" });
      chargerDonnees();
    } catch {
      toast({ variant: "destructive", title: "Échec de l'opération" });
    }
  };

  // ---- Types de tiers (icônes, édition, archivage) ----
  const ouvrirTypeTiers = (t?: TypeTiersPayeur) => {
    setTypeTiersEnEdition(t ?? null);
    setFormTypeTiers(t ? { code: t.code, libelle: t.libelle } : { code: "", libelle: "" });
    setDialogTypeTiersOuvert(true);
  };

  const enregistrerTypeTiers = async () => {
    if (!formTypeTiers.code || !formTypeTiers.libelle) {
      toast({ variant: "destructive", title: "Code et libellé obligatoires" });
      return;
    }
    try {
      if (typeTiersEnEdition) {
        await db.update("ref_type_tiers_payeur", { code: typeTiersEnEdition.code }, { libelle: formTypeTiers.libelle });
        toast({ title: "Type de tiers modifié" });
      } else {
        await db.create("ref_type_tiers_payeur", { ...formTypeTiers, actif: true });
        toast({ title: "Type de tiers créé" });
      }
      setDialogTypeTiersOuvert(false);
      setFormTypeTiers({ code: "", libelle: "" });
      chargerDonnees();
    } catch {
      toast({ variant: "destructive", title: "Échec de l'enregistrement" });
    }
  };

  const dupliquerTypeTiers = (t: TypeTiersPayeur) => {
    setTypeTiersEnEdition(null);
    setFormTypeTiers({ code: "", libelle: `${t.libelle} (copie)` });
    setDialogTypeTiersOuvert(true);
  };

  const archiverTypeTiers = async (t: TypeTiersPayeur) => {
    try {
      await db.update("ref_type_tiers_payeur", { code: t.code }, { actif: !t.actif });
      toast({ title: t.actif ? "Type archivé" : "Type réactivé" });
      chargerDonnees();
    } catch {
      toast({ variant: "destructive", title: "Échec de l'opération" });
    }
  };

  // ---- Types de retenue (icônes, édition, archivage) ----
  const ouvrirType = (t?: TypeRetenueSource) => {
    setTypeEnEdition(t ?? null);
    setFormType(
      t
        ? { code: t.code, libelle: t.libelle, rubrique_paie_code: t.rubrique_paie_code, priorite_defaut: t.priorite_defaut }
        : { code: "", libelle: "", rubrique_paie_code: "", priorite_defaut: 100 }
    );
    setDialogTypeOuvert(true);
  };

  const enregistrerType = async () => {
    if (!formType.code || !formType.libelle || !formType.rubrique_paie_code) {
      toast({
        variant: "destructive",
        title: "Champs incomplets",
        description: "Code, libellé et rubrique sont obligatoires.",
      });
      return;
    }
    try {
      if (typeEnEdition) {
        await db.update(
          "ref_type_retenue_source",
          { code: typeEnEdition.code },
          { libelle: formType.libelle, priorite_defaut: formType.priorite_defaut }
        );
        toast({ title: "Type de retenue modifié" });
      } else {
        await db.create("ref_type_retenue_source", { ...formType, actif: true });
        toast({ title: "Type de retenue créé" });
      }
      setDialogTypeOuvert(false);
      setFormType({ code: "", libelle: "", rubrique_paie_code: "", priorite_defaut: 100 });
      chargerDonnees();
    } catch {
      toast({
        variant: "destructive",
        title: "Échec de l'enregistrement",
        description: "Cette rubrique est peut-être déjà associée à un autre type (une rubrique = un seul type).",
      });
    }
  };

  const dupliquerType = (t: TypeRetenueSource) => {
    setTypeEnEdition(null);
    // Rubrique volontairement vidée : la contrainte "une rubrique = un seul
    // type" empêche de reprendre celle de l'original.
    setFormType({ code: "", libelle: `${t.libelle} (copie)`, rubrique_paie_code: "", priorite_defaut: t.priorite_defaut });
    setDialogTypeOuvert(true);
  };

  const archiverType = async (t: TypeRetenueSource) => {
    try {
      await db.update("ref_type_retenue_source", { code: t.code }, { actif: !t.actif });
      toast({ title: t.actif ? "Type archivé" : "Type réactivé" });
      chargerDonnees();
    } catch {
      toast({ variant: "destructive", title: "Échec de l'opération" });
    }
  };

  // ---- Dossiers de retenue ----
  const ouvrirDossier = (d?: RetenueTiers) => {
    setDossierEnEdition(d ?? null);
    setFormDossier(
      d
        ? {
            collaborateur_id: d.collaborateur_id,
            tiers_payeur_id: d.tiers_payeur_id,
            type_retenue_source_code: d.type_retenue_source_code,
            priorite: d.priorite,
            reference_dossier: d.reference_dossier ?? "",
            date_debut: d.date_debut,
            date_fin: d.date_fin ?? "",
          }
        : {
            collaborateur_id: "",
            tiers_payeur_id: "",
            type_retenue_source_code: "",
            priorite: 100,
            reference_dossier: "",
            date_debut: new Date().toISOString().slice(0, 10),
            date_fin: "",
          }
    );
    setDialogDossierOuvert(true);
  };

  const enregistrerDossier = async () => {
    if (!formDossier.collaborateur_id || !formDossier.tiers_payeur_id || !formDossier.type_retenue_source_code) {
      toast({
        variant: "destructive",
        title: "Champs incomplets",
        description: "Collaborateur, tiers payeur et type de retenue sont obligatoires.",
      });
      return;
    }
    const payload = { ...formDossier, date_fin: formDossier.date_fin || null };
    try {
      if (dossierEnEdition) {
        await virementsApi.updateRetenueTiers(dossierEnEdition.id, payload);
        toast({ title: "Dossier modifié" });
      } else {
        await virementsApi.createRetenueTiers({ ...payload, statut: "ACTIF" } as Omit<RetenueTiers, "id">);
        toast({ title: "Dossier de retenue créé" });
      }
      setDialogDossierOuvert(false);
      chargerDonnees();
    } catch {
      toast({ variant: "destructive", title: "Échec de l'enregistrement du dossier" });
    }
  };

  const dupliquerDossier = (d: RetenueTiers) => {
    setDossierEnEdition(null);
    setFormDossier({
      collaborateur_id: "", // à choisir explicitement pour le nouveau dossier
      tiers_payeur_id: d.tiers_payeur_id,
      type_retenue_source_code: d.type_retenue_source_code,
      priorite: d.priorite,
      reference_dossier: "",
      date_debut: new Date().toISOString().slice(0, 10),
      date_fin: "",
    });
    setDialogDossierOuvert(true);
  };

  const suspendre = async (dossier: RetenueTiers) => {
    try {
      await virementsApi.suspendreRetenueTiers(dossier.id);
      toast({ title: "Dossier suspendu" });
      chargerDonnees();
    } catch {
      toast({ variant: "destructive", title: "Échec de la suspension" });
    }
  };

  const badgeStatut = (statut: RetenueTiers["statut"]) => {
    const variant = statut === "ACTIF" ? "default" : statut === "SUSPENDU" ? "secondary" : "outline";
    const libelle = statut === "ACTIF" ? "Actif" : statut === "SUSPENDU" ? "Suspendu" : "Soldé";
    return <Badge variant={variant}>{libelle}</Badge>;
  };

  const triDossiers = useTri(dossiers);
  const triTiers = useTri(tiers);
  const triTypesRetenue = useTri(typesRetenue);
  const triTypesTiers = useTri(typesTiers);

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: "hsl(var(--primary) / 0.12)" }}
        >
          <Landmark className="h-5 w-5" style={{ color: "hsl(var(--primary))" }} />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Tiers et dossiers de retenue</h1>
          <p className="text-sm text-muted-foreground">
            Bénéficiaires externes au collaborateur (oppositions, pensions alimentaires, cotisations)
            et dossiers de routage vers ces bénéficiaires.
          </p>
        </div>
      </div>

      <Tabs defaultValue="dossiers">
        <TabsList>
          <TabsTrigger value="dossiers" className="gap-1.5">
            <Hash className="h-3.5 w-3.5" />
            Dossiers de retenue
          </TabsTrigger>
          <TabsTrigger value="tiers" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Référentiel des tiers
          </TabsTrigger>
          <TabsTrigger value="types" className="gap-1.5">
            <ListChecks className="h-3.5 w-3.5" />
            Types de retenue
          </TabsTrigger>
          <TabsTrigger value="types-tiers" className="gap-1.5">
            <Settings2 className="h-3.5 w-3.5" />
            Types de tiers
          </TabsTrigger>
        </TabsList>

        {/* ---------------- Dossiers de retenue ---------------- */}
        <TabsContent value="dossiers" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => ouvrirDossier()}>
              <Plus className="mr-2 h-4 w-4" />
              Nouveau dossier
            </Button>
          </div>
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <EnteteTriable label="Collaborateur" col="collaborateur_nom" tri={triDossiers} />
                    <EnteteTriable label="Type" col="type_retenue_source_libelle" tri={triDossiers} />
                    <EnteteTriable label="Bénéficiaire" col="tiers_payeur_nom" tri={triDossiers} />
                    <EnteteTriable label="Rubrique" col="rubrique_paie_libelle" tri={triDossiers} />
                    <EnteteTriable label="Priorité" col="priorite" tri={triDossiers} className="text-center" />
                    <EnteteTriable label="Date fin" col="date_fin" tri={triDossiers} />
                    <EnteteTriable label="Statut" col="statut" tri={triDossiers} />
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {chargement && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">
                        Chargement...
                      </TableCell>
                    </TableRow>
                  )}
                  {!chargement && dossiers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">
                        Aucun dossier de retenue actif.
                      </TableCell>
                    </TableRow>
                  )}
                  {triDossiers.donneesTriees.map((dossier) => (
                    <TableRow key={dossier.id}>
                      <TableCell>
                        {dossier.collaborateur_nom ?? dossier.collaborateur_id}
                        {dossier.collaborateur_matricule && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({dossier.collaborateur_matricule})
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {dossier.type_retenue_source_libelle ?? dossier.type_retenue_source_code}
                        {dossier.priorite === 1 && (
                          <Badge variant="outline" className="ml-2 text-xs">
                            Prioritaire
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{dossier.tiers_payeur_nom ?? dossier.tiers_payeur_id}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {dossier.rubrique_paie_libelle ?? dossier.rubrique_paie_code}
                      </TableCell>
                      <TableCell className="text-center">{dossier.priorite}</TableCell>
                      <TableCell className="text-xs">{dossier.date_fin ?? "—"}</TableCell>
                      <TableCell>{badgeStatut(dossier.statut)}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <button onClick={() => ouvrirDossier(dossier)} title="Modifier" aria-label="Modifier">
                          <Pencil className="h-4 w-4" style={STYLE_ICONE_EDIT} />
                        </button>
                        <button onClick={() => dupliquerDossier(dossier)} title="Dupliquer" aria-label="Dupliquer">
                          <Copy className="h-4 w-4" style={STYLE_ICONE_DUPLIQUER} />
                        </button>
                        {dossier.statut === "ACTIF" && (
                          <button onClick={() => suspendre(dossier)} title="Suspendre" aria-label="Suspendre">
                            <PauseCircle className="h-4 w-4" style={STYLE_ICONE_ARCHIVE} />
                          </button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Référentiel des tiers ---------------- */}
        <TabsContent value="tiers" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setDialogTiersOuvert(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Nouveau tiers
            </Button>
          </div>
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <EnteteTriable label="Type" col="type_tiers_payeur_code" tri={triTiers} />
                    <EnteteTriable label="Nom" col="nom" tri={triTiers} />
                    <EnteteTriable label="RIB" col="rib" tri={triTiers} />
                    <EnteteTriable label="Référence externe" col="reference_externe" tri={triTiers} />
                    <EnteteTriable label="Statut" col="actif" tri={triTiers} />
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {triTiers.donneesTriees.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>{libelleTypeTiers(t.type_tiers_payeur_code)}</TableCell>
                      <TableCell>{t.nom}</TableCell>
                      <TableCell className="font-mono">{t.rib ?? "—"}</TableCell>
                      <TableCell>{t.reference_externe ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={t.actif ? "default" : "secondary"}>
                          {t.actif ? "Actif" : "Inactif"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <button onClick={() => dupliquerTiers(t)} title="Dupliquer" aria-label="Dupliquer">
                          <Copy className="h-4 w-4" style={STYLE_ICONE_DUPLIQUER} />
                        </button>
                        <button
                          onClick={() => archiverTiers(t)}
                          title={t.actif ? "Archiver" : "Réactiver"}
                          aria-label={t.actif ? "Archiver" : "Réactiver"}
                        >
                          {t.actif ? (
                            <Archive className="h-4 w-4" style={STYLE_ICONE_ARCHIVE} />
                          ) : (
                            <RotateCcw className="h-4 w-4" style={STYLE_ICONE_REACTIVER} />
                          )}
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Types de retenue ---------------- */}
        <TabsContent value="types" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => ouvrirType()}>
              <Plus className="mr-2 h-4 w-4" />
              Nouveau type
            </Button>
          </div>
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <EnteteTriable label="Code" col="code" tri={triTypesRetenue} />
                    <EnteteTriable label="Libellé" col="libelle" tri={triTypesRetenue} />
                    <EnteteTriable label="Rubrique de paie" col="rubrique_paie_libelle" tri={triTypesRetenue} />
                    <EnteteTriable label="Priorité par défaut" col="priorite_defaut" tri={triTypesRetenue} className="text-center" />
                    <EnteteTriable label="Statut" col="actif" tri={triTypesRetenue} />
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {typesRetenue.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        Aucun type configuré.
                      </TableCell>
                    </TableRow>
                  )}
                  {triTypesRetenue.donneesTriees.map((t) => (
                    <TableRow key={t.code}>
                      <TableCell className="font-mono text-xs">{t.code}</TableCell>
                      <TableCell>{t.libelle}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {t.rubrique_paie_libelle ?? t.rubrique_paie_code}
                      </TableCell>
                      <TableCell className="text-center">{t.priorite_defaut}</TableCell>
                      <TableCell>
                        <Badge variant={t.actif ? "default" : "secondary"}>
                          {t.actif ? "Actif" : "Archivé"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <button onClick={() => ouvrirType(t)} title="Modifier" aria-label="Modifier">
                          <Pencil className="h-4 w-4" style={STYLE_ICONE_EDIT} />
                        </button>
                        <button onClick={() => dupliquerType(t)} title="Dupliquer" aria-label="Dupliquer">
                          <Copy className="h-4 w-4" style={STYLE_ICONE_DUPLIQUER} />
                        </button>
                        <button
                          onClick={() => archiverType(t)}
                          title={t.actif ? "Archiver" : "Réactiver"}
                          aria-label={t.actif ? "Archiver" : "Réactiver"}
                        >
                          {t.actif ? (
                            <Archive className="h-4 w-4" style={STYLE_ICONE_ARCHIVE} />
                          ) : (
                            <RotateCcw className="h-4 w-4" style={STYLE_ICONE_REACTIVER} />
                          )}
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-3 text-xs text-muted-foreground">
                Chaque rubrique ne peut être associée qu'à un seul type (contrainte au niveau base).
                "Archiver" ne supprime rien : le type reste consultable, seulement masqué des nouvelles créations.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Types de tiers ---------------- */}
        <TabsContent value="types-tiers" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => ouvrirTypeTiers()}>
              <Plus className="mr-2 h-4 w-4" />
              Nouveau type
            </Button>
          </div>
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <EnteteTriable label="Code" col="code" tri={triTypesTiers} />
                    <EnteteTriable label="Libellé" col="libelle" tri={triTypesTiers} />
                    <EnteteTriable label="Statut" col="actif" tri={triTypesTiers} />
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {typesTiers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        Aucun type configuré.
                      </TableCell>
                    </TableRow>
                  )}
                  {triTypesTiers.donneesTriees.map((t) => (
                    <TableRow key={t.code}>
                      <TableCell className="font-mono text-xs">{t.code}</TableCell>
                      <TableCell>{t.libelle}</TableCell>
                      <TableCell>
                        <Badge variant={t.actif ? "default" : "secondary"}>
                          {t.actif ? "Actif" : "Archivé"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <button onClick={() => ouvrirTypeTiers(t)} title="Modifier" aria-label="Modifier">
                          <Pencil className="h-4 w-4" style={STYLE_ICONE_EDIT} />
                        </button>
                        <button onClick={() => dupliquerTypeTiers(t)} title="Dupliquer" aria-label="Dupliquer">
                          <Copy className="h-4 w-4" style={STYLE_ICONE_DUPLIQUER} />
                        </button>
                        <button
                          onClick={() => archiverTypeTiers(t)}
                          title={t.actif ? "Archiver" : "Réactiver"}
                          aria-label={t.actif ? "Archiver" : "Réactiver"}
                        >
                          {t.actif ? (
                            <Archive className="h-4 w-4" style={STYLE_ICONE_ARCHIVE} />
                          ) : (
                            <RotateCcw className="h-4 w-4" style={STYLE_ICONE_REACTIVER} />
                          )}
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog création tiers payeur */}
      <Dialog open={dialogTiersOuvert} onOpenChange={setDialogTiersOuvert}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouveau tiers payeur</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Type</Label>
              <Select
                value={formTiers.type_tiers_payeur_code}
                onValueChange={(v) => setFormTiers((f) => ({ ...f, type_tiers_payeur_code: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un type" />
                </SelectTrigger>
                <SelectContent>
                  {typesTiers.filter((t) => t.actif).map((t) => (
                    <SelectItem key={t.code} value={t.code}>
                      {t.libelle}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {typesTiers.length === 0 && (
                <p className="mt-1 text-xs" style={{ color: "hsl(var(--warning))" }}>
                  Aucun type configuré — créez-en un dans l'onglet "Types de tiers" avant de continuer.
                </p>
              )}
            </div>
            <div>
              <Label>Nom</Label>
              <Input
                value={formTiers.nom}
                onChange={(e) => setFormTiers((f) => ({ ...f, nom: e.target.value }))}
              />
            </div>
            <div>
              <Label>RIB (24 chiffres, optionnel si paiement hors virement)</Label>
              <Input
                maxLength={24}
                className="font-mono"
                value={formTiers.rib ?? ""}
                onChange={(e) =>
                  setFormTiers((f) => ({ ...f, rib: e.target.value.replace(/\D/g, "") }))
                }
              />
            </div>
            <div>
              <Label>Référence externe (n° dossier tribunal, n° d'affiliation...)</Label>
              <Input
                value={formTiers.reference_externe ?? ""}
                onChange={(e) => setFormTiers((f) => ({ ...f, reference_externe: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogTiersOuvert(false)}>
              Annuler
            </Button>
            <Button onClick={enregistrerTiers}>Créer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog création/modification dossier de retenue */}
      <Dialog open={dialogDossierOuvert} onOpenChange={setDialogDossierOuvert}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
                style={{ backgroundColor: "hsl(var(--primary) / 0.12)" }}
              >
                <Hash className="h-4 w-4" style={{ color: "hsl(var(--primary))" }} />
              </div>
              <DialogTitle>{dossierEnEdition ? "Modifier le dossier" : "Nouveau dossier de retenue"}</DialogTitle>
            </div>
          </DialogHeader>

          <div className="space-y-5">
            {/* Section bénéficiaire */}
            <div className="space-y-3 rounded-lg border bg-muted/30 p-5">
              <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <User className="h-3.5 w-3.5" />
                Qui est concerné
              </div>

              <div>
                <Label>Collaborateur</Label>
                <CollaborateurPicker
                  value={formDossier.collaborateur_id}
                  onChange={(id: string) => setFormDossier((f) => ({ ...f, collaborateur_id: id }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-5">
                <div>
                  <Label>Type de retenue</Label>
                  <Select
                    value={formDossier.type_retenue_source_code}
                    onValueChange={(v) => {
                      const type = typesRetenue.find((t) => t.code === v);
                      setFormDossier((f) => ({
                        ...f,
                        type_retenue_source_code: v,
                        priorite: type?.priorite_defaut ?? 100,
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner un type" />
                    </SelectTrigger>
                    <SelectContent>
                      {typesRetenue.filter((t) => t.actif).map((t) => (
                        <SelectItem key={t.code} value={t.code}>
                          {t.libelle}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {typesRetenue.length === 0 && (
                    <p className="mt-1 flex items-center gap-1 text-xs" style={{ color: "hsl(var(--warning))" }}>
                      <ShieldAlert className="h-3 w-3" />
                      Créez un type dans l'onglet dédié.
                    </p>
                  )}
                </div>
                <div>
                  <Label>Tiers bénéficiaire</Label>
                  <Select
                    value={formDossier.tiers_payeur_id}
                    onValueChange={(v) => setFormDossier((f) => ({ ...f, tiers_payeur_id: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner un tiers" />
                    </SelectTrigger>
                    <SelectContent>
                      {tiers.filter((t) => t.actif).map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.nom} — {libelleTypeTiers(t.type_tiers_payeur_code)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {formDossier.type_retenue_source_code && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
                    style={{
                      backgroundColor: "hsl(var(--secondary) / 0.15)",
                      color: "hsl(var(--secondary))",
                      border: "1px solid hsl(var(--secondary) / 0.4)",
                    }}
                  >
                    <Tag className="h-3 w-3" />
                    {typesRetenue.find((t) => t.code === formDossier.type_retenue_source_code)?.rubrique_paie_libelle ??
                      typesRetenue.find((t) => t.code === formDossier.type_retenue_source_code)?.rubrique_paie_code}
                  </span>
                  {formDossier.priorite === 1 && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
                      style={{
                        backgroundColor: "hsl(var(--destructive) / 0.12)",
                        color: "hsl(var(--destructive))",
                        border: "1px solid hsl(var(--destructive) / 0.35)",
                      }}
                    >
                      <ShieldAlert className="h-3 w-3" />
                      Prioritaire
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Section détails du dossier */}
            <div className="space-y-3 rounded-lg border bg-muted/30 p-5">
              <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" />
                Détails du dossier
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>Référence dossier</Label>
                  <Input
                    value={formDossier.reference_dossier}
                    onChange={(e) =>
                      setFormDossier((f) => ({ ...f, reference_dossier: e.target.value }))
                    }
                    placeholder="Optionnel"
                  />
                </div>
                <div>
                  <Label>Date de début</Label>
                  <Input
                    type="date"
                    value={formDossier.date_debut}
                    onChange={(e) => setFormDossier((f) => ({ ...f, date_debut: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Date de fin</Label>
                  <Input
                    type="date"
                    value={formDossier.date_fin}
                    onChange={(e) => setFormDossier((f) => ({ ...f, date_fin: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogDossierOuvert(false)}>
              Annuler
            </Button>
            <Button onClick={enregistrerDossier}>{dossierEnEdition ? "Enregistrer" : "Créer le dossier"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog création/modification type de retenue */}
      <Dialog open={dialogTypeOuvert} onOpenChange={setDialogTypeOuvert}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{typeEnEdition ? "Modifier le type de retenue" : "Nouveau type de retenue"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Code (identifiant technique, sans espace)</Label>
              <Input
                disabled={!!typeEnEdition}
                className={typeEnEdition ? "bg-muted" : ""}
                value={formType.code}
                onChange={(e) =>
                  setFormType((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/\s+/g, "_") }))
                }
                placeholder="ex. OPPOSITION"
              />
            </div>
            <div>
              <Label>Libellé</Label>
              <Input
                value={formType.libelle}
                onChange={(e) => setFormType((f) => ({ ...f, libelle: e.target.value }))}
                placeholder="ex. Opposition / saisie-arrêt"
              />
            </div>
            <div>
              <Label>Rubrique de paie associée</Label>
              <Select
                disabled={!!typeEnEdition}
                value={formType.rubrique_paie_code}
                onValueChange={(v) => setFormType((f) => ({ ...f, rubrique_paie_code: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner une rubrique" />
                </SelectTrigger>
                <SelectContent>
                  {rubriquesRetenue
                    .filter(
                      (r) => typeEnEdition?.rubrique_paie_code === r.code || !typesRetenue.some((t) => t.rubrique_paie_code === r.code)
                    )
                    .map((r) => (
                      <SelectItem key={r.code} value={r.code}>
                        {r.libelle}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                {typeEnEdition
                  ? "La rubrique n'est plus modifiable une fois le type créé."
                  : "Seules les rubriques pas encore associées à un type sont proposées."}
              </p>
            </div>
            <div>
              <Label>Priorité par défaut</Label>
              <Input
                type="number"
                min={1}
                value={formType.priorite_defaut}
                onChange={(e) => setFormType((f) => ({ ...f, priorite_defaut: Number(e.target.value) }))}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Plus la valeur est basse, plus la priorité est haute (1 = priorité maximale).
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogTypeOuvert(false)}>
              Annuler
            </Button>
            <Button onClick={enregistrerType}>{typeEnEdition ? "Enregistrer" : "Créer le type"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog création/modification type de tiers payeur */}
      <Dialog open={dialogTypeTiersOuvert} onOpenChange={setDialogTypeTiersOuvert}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{typeTiersEnEdition ? "Modifier le type de tiers" : "Nouveau type de tiers"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Code (identifiant technique, sans espace)</Label>
              <Input
                disabled={!!typeTiersEnEdition}
                className={typeTiersEnEdition ? "bg-muted" : ""}
                value={formTypeTiers.code}
                onChange={(e) =>
                  setFormTypeTiers((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/\s+/g, "_") }))
                }
                placeholder="ex. HUISSIER"
              />
            </div>
            <div>
              <Label>Libellé</Label>
              <Input
                value={formTypeTiers.libelle}
                onChange={(e) => setFormTypeTiers((f) => ({ ...f, libelle: e.target.value }))}
                placeholder="ex. Huissier de justice"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogTypeTiersOuvert(false)}>
              Annuler
            </Button>
            <Button onClick={enregistrerTypeTiers}>{typeTiersEnEdition ? "Enregistrer" : "Créer le type"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
