import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useManagerPopulation } from "@/hooks/useManagerPopulation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import {
  Search, Plus, RefreshCw, TrendingUp, Clock, CheckCircle,
  AlertTriangle, Edit, Trash2, Zap, Wand2, ArrowRightLeft, History,
  CalendarDays, FileCheck, XCircle, HourglassIcon,
  ArrowUpDown, ArrowUp, ArrowDown, Filter, Download,
} from "lucide-react";
import * as XLSX from "xlsx";

// ── Types ───────────────────────────────────────────────────
interface Collaborateur { id: string; matricule: string; nom: string; prenom: string; }
interface PopulationCriteres {
  genres: string[];
  categories_pro: string[];
  types_contrat: string[];
  anciennete_min_mois: number | null;
  anciennete_max_mois: number | null;
}
interface TypeConge {
  code: string;
  libelle: string;
  code_famille: string | null;
  population_criteres: PopulationCriteres | null;
}
interface FamilleConge { code: string; libelle: string; couleur: string | null; }
interface SoldeRow {
  id: string;
  collaborateur_id: string;
  code_type_conge: string;
  exercice: number;
  solde_acquis: number;
  solde_pris: number;
  solde_en_attente: number;
  solde_restant: number;
  reliquat_reporte: number;
  date_calcul: string;
  collaborateurs?: { nom: string; prenom: string; matricule: string };
}
interface DroitRow {
  id: string;
  collaborateur_id: string;
  code_type_conge: string;
  exercice: number;
  periode_debut: string;
  periode_fin: string;
  jours_acquis: number;
  commentaire: string | null;
}
interface CollaborateurAvecContrat {
  id: string;
  matricule: string;
  nom: string;
  prenom: string;
  date_debut_contrat: string | null;
  code_type_contrat: string | null;   // ← pour le filtre Option B
}
interface ConsommationRow {
  id: string;
  date_debut: string;
  date_retour: string;
  nbr_jours_calendaires: number;
  nbr_jours_decomptes: number;
  exercice: number;
  est_annulee: boolean;
  code_type_conge: string;
}
interface DemandeRow {
  id: string;
  date_debut: string;
  date_fin_absence: string;
  date_retour: string;
  nbr_jours_calendaires: number | null;
  nbr_jours_decomptes: number | null;
  statut: string;
  code_type_conge: string;
  commentaire_collaborateur: string | null;
  commentaire_gestionnaire: string | null;
  date_soumission: string | null;
}
interface HistoriqueTarget { collaborateur_id: string; nom: string; prenom: string; matricule: string; code_type_conge: string; }

const EXERCICE_COURANT = new Date().getFullYear();

// ── Page Principale ─────────────────────────────────────────
export default function CompteurCongesPage() {
  const qc = useQueryClient();
  const { role } = useAuth();
  const isManager = role === "manager";
  const { collaborateurIds: managerCollabIds, loading: popLoading } = useManagerPopulation();
  const [searchCollab, setSearchCollab] = useState("");
  const [filterExercice, setFilterExercice] = useState(String(EXERCICE_COURANT));
  const [filterType, setFilterType] = useState("ALL");
  const [selectedCollab, setSelectedCollab] = useState<string | null>(null);
  const [openDroitDialog, setOpenDroitDialog] = useState(false);
  const [searchDroitCollab, setSearchDroitCollab] = useState("");
  const [editDroit, setEditDroit] = useState<DroitRow | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  // Forcer reliquat
  const [openReliquatDialog, setOpenReliquatDialog] = useState(false);
  const [reliquatTarget, setReliquatTarget] = useState<SoldeRow | null>(null);
  const [reliquatForm, setReliquatForm] = useState({
    jours_reliquat: 0,
    exercice_origine: EXERCICE_COURANT - 1,
    date_butoir: `${EXERCICE_COURANT}-12-31`,
    commentaire: "",
  });

  // Historique des congés
  const [openHistoriqueDialog, setOpenHistoriqueDialog] = useState(false);
  const [historiqueTarget, setHistoriqueTarget] = useState<HistoriqueTarget | null>(null);

  // ── États tri & filtre par onglet ────────────────────────────────────────
  type SortDir = "asc" | "desc";

  // Onglet Soldes
  const [soldeSearch, setSoldeSearch] = useState("");
  const [soldeSortCol, setSoldeSortCol] = useState<string>("nom");
  const [soldeSortDir, setSoldeSortDir] = useState<SortDir>("asc");

  // Onglet Droits
  const [droitSearch, setDroitSearch] = useState("");
  const [droitSortCol, setDroitSortCol] = useState<string>("nom");
  const [droitSortDir, setDroitSortDir] = useState<SortDir>("asc");

  // Onglet Sans droits
  const [sansDroitSearch, setSansDroitSearch] = useState("");
  const [sansDroitSortCol, setSansDroitSortCol] = useState<string>("nom");
  const [sansDroitSortDir, setSansDroitSortDir] = useState<SortDir>("asc");

  // Helper toggle tri
  const toggleSort = (
    col: string,
    currentCol: string,
    currentDir: SortDir,
    setCol: (c: string) => void,
    setDir: (d: SortDir) => void
  ) => {
    if (currentCol === col) setDir(currentDir === "asc" ? "desc" : "asc");
    else { setCol(col); setDir("asc"); }
  };

  // Icône de tri
  const SortIcon = ({ col, currentCol, currentDir }: { col: string; currentCol: string; currentDir: SortDir }) => {
    if (currentCol !== col) return <ArrowUpDown size={12} className="ml-1 opacity-30" />;
    return currentDir === "asc"
      ? <ArrowUp size={12} className="ml-1 text-accent" />
      : <ArrowDown size={12} className="ml-1 text-accent" />;
  };

  // Header de colonne triable
  const SortableHead = ({
    col, label, currentCol, currentDir, setCol, setDir, className = "",
  }: {
    col: string; label: string;
    currentCol: string; currentDir: SortDir;
    setCol: (c: string) => void; setDir: (d: SortDir) => void;
    className?: string;
  }) => (
    <TableHead
      className={`cursor-pointer select-none hover:bg-muted/40 transition-colors ${className}`}
      onClick={() => toggleSort(col, currentCol, currentDir, setCol, setDir)}>
      <span className="inline-flex items-center">
        {label}
        <SortIcon col={col} currentCol={currentCol} currentDir={currentDir} />
      </span>
    </TableHead>
  );

  // Formulaire droit
  const [droitForm, setDroitForm] = useState({
    collaborateur_id: "", code_type_conge: "", exercice: EXERCICE_COURANT,
    periode_debut: `${EXERCICE_COURANT}-01-01`, periode_fin: `${EXERCICE_COURANT}-12-31`,
    jours_acquis: 0, commentaire: "",
  });

  // ── Données ──────────────────────────────────────────────
  const { data: collaborateurs = [] } = useQuery<Collaborateur[]>({
    queryKey: ["collaborateurs-actifs", isManager, managerCollabIds],
    enabled: !isManager || !popLoading,
    queryFn: async () => {
      let q = supabase
        .from("collaborateurs")
        .select("id, matricule, nom, prenom")
        .eq("archive", false)
        .eq("statut_collaborateur", "ACTIF")
        .order("nom");
      if (isManager) {
        if (managerCollabIds.length === 0) return [];
        q = q.in("id", managerCollabIds);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  // Collaborateurs avec leur date d'entrée (1er contrat actif)
  const { data: collabsAvecContrat = [] } = useQuery<CollaborateurAvecContrat[]>({
    queryKey: ["collabs-avec-contrat-actif", filterExercice, isManager, managerCollabIds],
    enabled: !isManager || !popLoading,
    queryFn: async () => {
      // RG-CONGE-COLLAB-01 : Collaborateurs ACTIF avec contrat ACTIF
      let q = (supabase.from("collaborateurs" as never) as any)
        .select("id, matricule, nom, prenom")
        .eq("archive", false)
        .eq("statut_collaborateur", "ACTIF")   // Fix : exclure SUSPENDU etc.
        .order("nom");
      if (isManager) {
        if (managerCollabIds.length === 0) return [];
        q = q.in("id", managerCollabIds);
      }
      const { data: collabs, error } = await q;
      if (error) throw error;

      const collabIds = (collabs || []).map((c: any) => c.id);
      if (collabIds.length === 0) return [];

      // Récupérer les contrats ACTIF uniquement (exclure CLOTURE)
      const { data: contrats } = await (supabase.from("collaborateur_contrats" as never) as any)
        .select("collaborateur_id, date_debut, date_sortie, code_statut_contrat, code_type_contrat")
        .eq("archive", false)
        .eq("code_statut_contrat", "ACTIF")    // Fix : exclure contrats CLOTURES
        .is("date_sortie", null)
        .in("collaborateur_id", collabIds);

      // RG-CONGE-DATE-01 : Normaliser la date_debut au format yyyy-MM-dd
      const normalizeDate = (raw: string | null): string | null => {
        if (!raw) return null;
        const match = raw.match(/^(\d{1,3})-(\d{2})-(\d{2})$/);
        if (match) {
          const [, yr, mo, dy] = match;
          const fullYear = yr.length < 4 ? `20${yr.slice(-2)}` : yr;
          return `${fullYear}-${mo}-${dy}`;
        }
        return raw;
      };

      // Map : collaborateur_id → { date_debut, code_type_contrat }
      const contratsMap = new Map<string, { date: string; type_contrat: string }>();
      (contrats || []).forEach((ct: any) => {
        if (!contratsMap.has(ct.collaborateur_id)) {
          const dateNormalized = normalizeDate(ct.date_debut);
          if (dateNormalized) {
            contratsMap.set(ct.collaborateur_id, {
              date: dateNormalized,
              type_contrat: ct.code_type_contrat || "",
            });
          }
        }
      });

      return (collabs || [])
        .filter((c: any) => contratsMap.has(c.id))
        .map((c: any) => ({
          id: c.id,
          matricule: c.matricule,
          nom: c.nom,
          prenom: c.prenom,
          date_debut_contrat: contratsMap.get(c.id)?.date || null,
          code_type_contrat:  contratsMap.get(c.id)?.type_contrat || null,
        }));
    },
  });

  const { data: typesConge = [] } = useQuery<TypeConge[]>({
    queryKey: ["ref-type-conge-actifs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ref_type_conge" as never)
        .select("code, libelle, code_famille, population_criteres")
        .eq("actif" as never, true as never)
        .order("libelle" as never) as any;
      if (error) throw error;
      return (data || []) as TypeConge[];
    },
  });

  const { data: famillesConge = [] } = useQuery<FamilleConge[]>({
    queryKey: ["ref-famille-conge"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ref_famille_conge" as never)
        .select("code, libelle, couleur")
        .order("libelle" as never) as any;
      if (error) throw error;
      return (data || []) as FamilleConge[];
    },
  });

  const { data: soldes = [], isLoading: soldesLoading } = useQuery<SoldeRow[]>({
    queryKey: ["cong-soldes", filterExercice, filterType, searchCollab, isManager, managerCollabIds],
    enabled: !isManager || !popLoading,
    queryFn: async () => {
      let q = supabase
        .from("cong_solde")
        .select("*, collaborateurs(nom, prenom, matricule)")
        .eq("exercice", Number(filterExercice))
        .eq("archive", false);
      if (filterType !== "ALL") q = q.eq("code_type_conge", filterType);
      if (isManager) {
        if (managerCollabIds.length === 0) return [];
        q = q.in("collaborateur_id", managerCollabIds);
      }
      const { data, error } = await q.order("collaborateur_id");
      if (error) throw error;
      return (data || []).filter((s: SoldeRow) => {
        if (!searchCollab) return true;
        const c = s.collaborateurs;
        const term = searchCollab.toLowerCase();
        return (
          c?.nom?.toLowerCase().includes(term) ||
          c?.prenom?.toLowerCase().includes(term) ||
          c?.matricule?.toLowerCase().includes(term)
        );
      });
    },
  });

  const { data: droits = [], isLoading: droitsLoading } = useQuery<DroitRow[]>({
    queryKey: ["cong-droits", filterExercice, selectedCollab, isManager, managerCollabIds],
    enabled: !isManager || !popLoading,
    queryFn: async () => {
      let q = supabase
        .from("cong_droits")
        .select("*")
        .eq("exercice", Number(filterExercice))
        .eq("archive", false)
        .order("created_at", { ascending: false });
      if (selectedCollab) q = q.eq("collaborateur_id", selectedCollab);
      else if (isManager) {
        if (managerCollabIds.length === 0) return [];
        q = q.in("collaborateur_id", managerCollabIds);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  // IDs des collaborateurs ayant déjà des droits pour l'exercice courant
  const { data: collabsAvecDroits = [] } = useQuery<string[]>({
    queryKey: ["collabs-avec-droits", filterExercice, isManager, managerCollabIds],
    enabled: !isManager || !popLoading,
    queryFn: async () => {
      let q = supabase
        .from("cong_droits")
        .select("collaborateur_id")
        .eq("exercice", Number(filterExercice))
        .eq("archive", false);
      if (isManager && managerCollabIds.length > 0) {
        q = q.in("collaborateur_id", managerCollabIds);
      }
      const { data, error } = await q;
      if (error) throw error;
      return [...new Set((data || []).map((d: any) => d.collaborateur_id))];
    },
  });

  // Consommations pour l'historique (tous exercices)
  const { data: histoConsommations = [], isLoading: histoConsLoading } = useQuery<ConsommationRow[]>({
    queryKey: ["histo-consommations", historiqueTarget?.collaborateur_id, historiqueTarget?.code_type_conge],
    enabled: !!historiqueTarget,
    queryFn: async () => {
      const { data, error } = await (supabase.from("cong_consommation" as never) as any)
        .select("id, date_debut, date_retour, nbr_jours_calendaires, nbr_jours_decomptes, exercice, est_annulee, code_type_conge")
        .eq("collaborateur_id", historiqueTarget!.collaborateur_id)
        .eq("code_type_conge", historiqueTarget!.code_type_conge)
        .order("date_debut", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: histoDemandes = [], isLoading: histoDemandesLoading } = useQuery<DemandeRow[]>({
    queryKey: ["histo-demandes", historiqueTarget?.collaborateur_id, historiqueTarget?.code_type_conge],
    enabled: !!historiqueTarget,
    queryFn: async () => {
      const { data, error } = await (supabase.from("cong_demande" as never) as any)
        .select("id, date_debut, date_fin_absence, date_retour, nbr_jours_calendaires, nbr_jours_decomptes, statut, code_type_conge, commentaire_collaborateur, commentaire_gestionnaire, date_soumission")
        .eq("collaborateur_id", historiqueTarget!.collaborateur_id)
        .eq("code_type_conge", historiqueTarget!.code_type_conge)
        .order("date_debut", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // ── Mutations ─────────────────────────────────────────────
  const saveDroit = useMutation({
    mutationFn: async (form: typeof droitForm & { id?: string }) => {
      const { id, ...payload } = form;
      if (id) {
        const { error } = await supabase.from("cong_droits").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("cong_droits").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cong-droits"] });
      qc.invalidateQueries({ queryKey: ["cong-soldes"] });
      qc.invalidateQueries({ queryKey: ["collabs-avec-droits"] });
      toast({ title: "Droit enregistré avec succès" });
      setOpenDroitDialog(false);
    },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const deleteDroit = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cong_droits").update({ archive: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cong-droits"] });
      qc.invalidateQueries({ queryKey: ["cong-soldes"] });
      qc.invalidateQueries({ queryKey: ["collabs-avec-droits"] });
      toast({ title: "Droit supprimé" });
    },
  });

  // Recalcul global des soldes
  const recalculAll = useMutation({
    mutationFn: async () => {
      const soldesARecalculer = [...new Map(
        soldes.map(s => [`${s.collaborateur_id}_${s.code_type_conge}`, s])
      ).values()];
      for (const s of soldesARecalculer) {
        await supabase.rpc("recalculate_cong_solde", {
          p_collaborateur_id: s.collaborateur_id,
          p_code_type_conge: s.code_type_conge,
          p_exercice: Number(filterExercice),
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cong-soldes"] });
      toast({ title: "Soldes recalculés avec succès" });
    },
  });

  // Génération droits pour un collaborateur
  const genererDroitsCollab = async (collabId: string, dateEntree: string) => {
    setGeneratingId(collabId);
    try {
      const { data, error } = await supabase.rpc("generate_droits_proportionnels", {
        p_collaborateur_id: collabId,
        p_date_entree: dateEntree,
        p_exercice: Number(filterExercice),
      });
      if (error) throw error;
      const nbCreated = data as number;
      qc.invalidateQueries({ queryKey: ["cong-droits"] });
      qc.invalidateQueries({ queryKey: ["cong-soldes"] });
      qc.invalidateQueries({ queryKey: ["collabs-avec-droits"] });
      if (nbCreated > 0) {
        toast({ title: `${nbCreated} droit(s) généré(s)`, description: `Prorata calculé depuis le ${new Date(dateEntree).toLocaleDateString("fr-FR")}` });
      } else {
        toast({ title: "Droits déjà existants", description: "Aucun nouveau droit à générer.", variant: "default" });
      }
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setGeneratingId(null);
    }
  };

  // Génération droits pour TOUS les collaborateurs sans droits
  const genererTousDroits = useMutation({
    mutationFn: async () => {
      // RG-CONGE-GEN-01 : Ne générer que pour les collaborateurs avec un contrat ACTIF
      // collabsAvecContrat est déjà filtré sur code_statut_contrat = ACTIF
      const sansDroits = collabsAvecContrat.filter(
        c => !collabsAvecDroits.includes(c.id) && c.date_debut_contrat
      );
      let total = 0;
      const errors: string[] = [];
      for (const c of sansDroits) {
        const { data, error } = await supabase.rpc("generate_droits_proportionnels", {
          p_collaborateur_id: c.id,
          p_date_entree: c.date_debut_contrat!,
          p_exercice: Number(filterExercice),
        });
        if (error) {
          errors.push(`${c.nom} ${c.prenom} : ${error.message}`);
        } else {
          total += (data as number) || 0;
        }
      }
      return { nbCollabs: sansDroits.length, nbDroits: total, errors };
    },
    onSuccess: ({ nbCollabs, nbDroits, errors }) => {
      qc.invalidateQueries({ queryKey: ["cong-droits"] });
      qc.invalidateQueries({ queryKey: ["cong-soldes"] });
      qc.invalidateQueries({ queryKey: ["collabs-avec-droits"] });
      if (errors.length > 0) {
        toast({
          title: `Génération partielle`,
          description: `${nbDroits} droit(s) créé(s) pour ${nbCollabs - errors.length}/${nbCollabs} collaborateur(s). ${errors.length} erreur(s).`,
          variant: "default",
        });
      } else {
        toast({
          title: `Génération terminée`,
          description: `${nbDroits} droit(s) créé(s) pour ${nbCollabs} collaborateur(s)`,
        });
      }
    },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  // Forcer reliquat mutation
  const forcerReliquat = useMutation({
    mutationFn: async () => {
      if (!reliquatTarget) return;
      const exerciceReport = Number(filterExercice);
      const exerciceOrigine = reliquatForm.exercice_origine;

      // Vérifier si un reliquat actif existe déjà pour cette combinaison
      const { data: existingData, error: existingError } = await (supabase.from("cong_reliquat" as never) as any)
        .select("id")
        .eq("collaborateur_id", reliquatTarget.collaborateur_id)
        .eq("code_type_conge", reliquatTarget.code_type_conge)
        .eq("exercice_origine", exerciceOrigine)
        .eq("exercice_report", exerciceReport)
        .eq("statut", "ACTIF")
        .maybeSingle();
      if (existingError) throw existingError;
      const existing = existingData as { id: string } | null;

      if (existing?.id) {
        // Mise à jour du reliquat existant
        const { error } = await supabase
          .from("cong_reliquat")
          .update({
            jours_reliquat: reliquatForm.jours_reliquat,
            date_butoir: reliquatForm.date_butoir,
            commentaire: reliquatForm.commentaire || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        // Création d'un nouveau reliquat forcé
        const { error } = await supabase.from("cong_reliquat").insert({
          collaborateur_id: reliquatTarget.collaborateur_id,
          code_type_conge: reliquatTarget.code_type_conge,
          exercice_origine: exerciceOrigine,
          exercice_report: exerciceReport,
          jours_reliquat: reliquatForm.jours_reliquat,
          jours_consommes: 0,
          date_butoir: reliquatForm.date_butoir,
          statut: "ACTIF",
          commentaire: reliquatForm.commentaire || null,
        });
        if (error) throw error;
      }

      // Recalcul du solde
      await supabase.rpc("recalculate_cong_solde", {
        p_collaborateur_id: reliquatTarget.collaborateur_id,
        p_code_type_conge: reliquatTarget.code_type_conge,
        p_exercice: exerciceReport,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cong-soldes"] });
      toast({ title: "Reliquat forcé avec succès" });
      setOpenReliquatDialog(false);
      setReliquatTarget(null);
    },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const openForcerReliquat = (s: SoldeRow) => {
    setReliquatTarget(s);
    setReliquatForm({
      jours_reliquat: Number(s.reliquat_reporte) || 0,
      exercice_origine: Number(filterExercice) - 1,
      date_butoir: `${filterExercice}-12-31`,
      commentaire: "",
    });
    setOpenReliquatDialog(true);
  };

  const openNewDroit = () => {
    setEditDroit(null);
    setDroitForm({
      collaborateur_id: selectedCollab || "",
      code_type_conge: "",
      exercice: EXERCICE_COURANT,
      periode_debut: `${EXERCICE_COURANT}-01-01`,
      periode_fin: `${EXERCICE_COURANT}-12-31`,
      jours_acquis: 0,
      commentaire: "",
    });
    setOpenDroitDialog(true);
  };

  const openEditDroit = (d: DroitRow) => {
    setEditDroit(d);
    // Pré-remplir le champ recherche avec le nom du collaborateur (lecture seule en mode édition)
    const collab = collaborateurs.find(c => c.id === d.collaborateur_id);
    setSearchDroitCollab(collab ? `${collab.nom} ${collab.prenom} (${collab.matricule})` : "");
    setDroitForm({
      collaborateur_id: d.collaborateur_id,
      code_type_conge: d.code_type_conge,
      exercice: d.exercice,
      periode_debut: d.periode_debut,
      periode_fin: d.periode_fin,
      jours_acquis: d.jours_acquis,
      commentaire: d.commentaire || "",
    });
    setOpenDroitDialog(true);
  };

  // ── KPIs ─────────────────────────────────────────────────
  const totalAcquis = soldes.reduce((s, r) => s + Number(r.solde_acquis), 0);
  const totalPris   = soldes.reduce((s, r) => s + Number(r.solde_pris), 0);
  const totalRest   = soldes.reduce((s, r) => s + Number(r.solde_restant), 0);
  const totalReliq  = soldes.reduce((s, r) => s + Number(r.reliquat_reporte), 0);

  // ── Option B (Adil DAIA) : un collaborateur est "sans droits" seulement s'il
  // existe au moins un type de congé actif (toutes familles confondues) auquel
  // il est éligible selon population_criteres.types_contrat ET pour lequel il
  // n'a pas encore de droit sur l'exercice en cours.
  // RG-CONGE-ELIGIBILITE-02 : évaluation par type, pas globalement.
  const collabsSansDroits = collabsAvecContrat.filter(c => {
    if (!c.date_debut_contrat) return false;

    // Tous les types actifs ayant un droit légal défini (droit_legal_jours > 0)
    // ou sans critère restrictif — peu importe la famille
    const typesCibles = typesConge.filter(t => {
      const crit = t.population_criteres;
      if (!crit) return true; // ouvert à tous

      // Type avec critères types_contrat explicites → inclus (on peut évaluer)
      if (crit.types_contrat && crit.types_contrat.length > 0) return true;

      // Aucun critère du tout = ouvert à tous
      if (
        crit.types_contrat.length === 0 &&
        crit.genres.length === 0 &&
        crit.categories_pro.length === 0 &&
        crit.anciennete_min_mois === null &&
        crit.anciennete_max_mois === null
      ) return true;

      return false;
    });

    // RG-CONGE-ELIGIBILITE-02 (Adil DAIA) : Pour chaque type éligible au
    // collaborateur (selon son type de contrat), vérifier s'il manque un droit.
    const aAuMoinsUnDroitManquant = typesCibles.some(t => {
      const crit = t.population_criteres;

      // Éligibilité du collaborateur pour CE type selon types_contrat
      const eligible = (() => {
        if (!crit || crit.types_contrat.length === 0) return true;
        return c.code_type_contrat
          ? crit.types_contrat.includes(c.code_type_contrat)
          : false;
      })();

      if (!eligible) return false;

      // Droit déjà existant pour CE type précis sur cet exercice ?
      const droitExiste = soldes.some(
        s => s.collaborateur_id === c.id && s.code_type_conge === t.code
      );

      return !droitExiste;
    });

    return aAuMoinsUnDroitManquant;
  });

  // ── Helpers (définis avant les données triées qui en dépendent) ──────────
  const getTypeLibelle = (code: string) => typesConge.find(t => t.code === code)?.libelle || code;
  const getCollabLabel = (id: string) => {
    const c = collaborateurs.find(c => c.id === id);
    return c ? `${c.nom} ${c.prenom} (${c.matricule})` : id;
  };
  const exercices = Array.from({ length: 5 }, (_, i) => String(EXERCICE_COURANT - 2 + i));

  // RG-CONGE-COMMENT-01 (Adil DAIA) : Décodage UTF-8 des commentaires
  const decodeComment = (s: string | null) =>
    s ? s
      .replace(/GÃ©nÃ©rÃ©/g, "Généré")
      .replace(/Ã©/g, "é").replace(/Ã¨/g, "è").replace(/Ã¡/g, "á")
      .replace(/Ã /g, "à").replace(/Ã¢/g, "â").replace(/Ã®/g, "î")
      .replace(/Ã´/g, "ô").replace(/Ã»/g, "û").replace(/Ã«/g, "ë")
      .replace(/Ã§/g, "ç").replace(/Ã¼/g, "ü").replace(/Ã¦/g, "æ")
      .replace(/â€™/g, "'").replace(/â€"/g, "—").replace(/â€œ/g, '"')
      .replace(/Â«/g, "«").replace(/Â»/g, "»").replace(/Âµ/g, "µ")
      .replace(/â€˜/g, "'").replace(/â€ž/g, '"').replace(/CongÃ©/g, "Congé")
      .replace(/entrÃ©e/g, "entrée")
    : null;

  // ── Exports Excel ──────────────────────────────────────────────────────
  const exportSoldes = () => {
    const rows = soldesFiltered.map((s: SoldeRow) => ({
      "Matricule":      s.collaborateurs?.matricule || "",
      "Nom":            s.collaborateurs?.nom || "",
      "Prénom":         s.collaborateurs?.prenom || "",
      "Type de congé":  getTypeLibelle(s.code_type_conge),
      "Exercice":       s.exercice,
      "Acquis":         Number(s.solde_acquis),
      "Pris":           Number(s.solde_pris),
      "En attente":     Number(s.solde_en_attente),
      "Reliquat":       Number(s.reliquat_reporte),
      "Solde restant":  Number(s.solde_restant),
      "Maj le":         s.date_calcul ? new Date(s.date_calcul).toLocaleDateString("fr-FR") : "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Soldes");
    XLSX.writeFile(wb, `compteurs_soldes_${filterExercice}.xlsx`);
  };

  const exportDroits = () => {
    const rows = droitsFiltered.map((d: DroitRow) => {
      const collab = collaborateurs.find(c => c.id === d.collaborateur_id);
      return {
        "Matricule":      collab?.matricule || "",
        "Nom":            collab?.nom || "",
        "Prénom":         collab?.prenom || "",
        "Type de congé":  getTypeLibelle(d.code_type_conge),
        "Exercice":       d.exercice,
        "Période début":  d.periode_debut ? new Date(d.periode_debut).toLocaleDateString("fr-FR") : "",
        "Période fin":    d.periode_fin ? new Date(d.periode_fin).toLocaleDateString("fr-FR") : "",
        "Jours acquis":   Number(d.jours_acquis),
        "Commentaire":    decodeComment(d.commentaire) || "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Droits");
    XLSX.writeFile(wb, `compteurs_droits_${filterExercice}.xlsx`);
  };

  const exportSansDroits = () => {
    const rows = sansDroitsFiltered.map(c => {
      const dateEntree = c.date_debut_contrat ? new Date(c.date_debut_contrat) : null;
      const anneeEntree = dateEntree?.getFullYear();
      const ex = Number(filterExercice);
      let mois = 12;
      if (dateEntree && anneeEntree === ex) mois = 13 - (dateEntree.getMonth() + 1);
      else if (dateEntree && anneeEntree! > ex) mois = 0;
      return {
        "Matricule":       c.matricule,
        "Nom":             c.nom,
        "Prénom":          c.prenom,
        "Type contrat":    c.code_type_contrat || "",
        "Date d'entrée":   dateEntree ? dateEntree.toLocaleDateString("fr-FR") : "",
        "Mois travaillés": mois,
        "Ratio":           `${((mois / 12) * 100).toFixed(0)}%`,
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sans droits");
    XLSX.writeFile(wb, `sans_droits_${filterExercice}.xlsx`);
  };

  // ── Données triées et filtrées par onglet ────────────────────────────────

  // Helper comparateur générique
  const cmpStr = (a: string, b: string, dir: SortDir) =>
    dir === "asc" ? a.localeCompare(b, "fr") : b.localeCompare(a, "fr");
  const cmpNum = (a: number, b: number, dir: SortDir) =>
    dir === "asc" ? a - b : b - a;

  // Onglet Soldes — filtre + tri
  const soldesFiltered = soldes
    .filter(s => {
      if (!soldeSearch.trim()) return true;
      const q = soldeSearch.toLowerCase();
      const collab = s.collaborateurs;
      return (
        collab?.nom?.toLowerCase().includes(q) ||
        collab?.prenom?.toLowerCase().includes(q) ||
        collab?.matricule?.toLowerCase().includes(q) ||
        getTypeLibelle(s.code_type_conge).toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      switch (soldeSortCol) {
        case "nom":     return cmpStr((a.collaborateurs?.nom || "") + (a.collaborateurs?.prenom || ""), (b.collaborateurs?.nom || "") + (b.collaborateurs?.prenom || ""), soldeSortDir);
        case "type":    return cmpStr(getTypeLibelle(a.code_type_conge), getTypeLibelle(b.code_type_conge), soldeSortDir);
        case "acquis":  return cmpNum(Number(a.solde_acquis), Number(b.solde_acquis), soldeSortDir);
        case "pris":    return cmpNum(Number(a.solde_pris), Number(b.solde_pris), soldeSortDir);
        case "attente": return cmpNum(Number(a.solde_en_attente), Number(b.solde_en_attente), soldeSortDir);
        case "reliquat":return cmpNum(Number(a.reliquat_reporte), Number(b.reliquat_reporte), soldeSortDir);
        case "restant": return cmpNum(Number(a.solde_restant), Number(b.solde_restant), soldeSortDir);
        case "maj":     return cmpStr(a.date_calcul, b.date_calcul, soldeSortDir);
        default:        return 0;
      }
    });

  // Onglet Droits — filtre + tri
  const droitsFiltered = droits
    .filter(d => {
      if (!droitSearch.trim()) return true;
      const q = droitSearch.toLowerCase();
      const label = getCollabLabel(d.collaborateur_id).toLowerCase();
      return label.includes(q) || getTypeLibelle(d.code_type_conge).toLowerCase().includes(q);
    })
    .sort((a, b) => {
      switch (droitSortCol) {
        case "nom":    return cmpStr(getCollabLabel(a.collaborateur_id), getCollabLabel(b.collaborateur_id), droitSortDir);
        case "type":   return cmpStr(getTypeLibelle(a.code_type_conge), getTypeLibelle(b.code_type_conge), droitSortDir);
        case "debut":  return cmpStr(a.periode_debut, b.periode_debut, droitSortDir);
        case "jours":  return cmpNum(Number(a.jours_acquis), Number(b.jours_acquis), droitSortDir);
        default:       return 0;
      }
    });

  // Onglet Sans droits — filtre + tri
  const sansDroitsFiltered = collabsSansDroits
    .filter(c => {
      if (!sansDroitSearch.trim()) return true;
      const q = sansDroitSearch.toLowerCase();
      return (
        c.nom.toLowerCase().includes(q) ||
        c.prenom.toLowerCase().includes(q) ||
        c.matricule.toLowerCase().includes(q) ||
        (c.code_type_contrat || "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      switch (sansDroitSortCol) {
        case "nom":    return cmpStr(a.nom + a.prenom, b.nom + b.prenom, sansDroitSortDir);
        case "type":   return cmpStr(a.code_type_contrat || "", b.code_type_contrat || "", sansDroitSortDir);
        case "entree": return cmpStr(a.date_debut_contrat || "", b.date_debut_contrat || "", sansDroitSortDir);
        case "ratio": {
          const ratioA = (() => { const d = a.date_debut_contrat ? new Date(a.date_debut_contrat) : null; const y = d?.getFullYear(); const ex = Number(filterExercice); if (!d) return 0; if (y! < ex) return 1; if (y! > ex) return 0; return (13 - (d.getMonth() + 1)) / 12; })();
          const ratioB = (() => { const d = b.date_debut_contrat ? new Date(b.date_debut_contrat) : null; const y = d?.getFullYear(); const ex = Number(filterExercice); if (!d) return 0; if (y! < ex) return 1; if (y! > ex) return 0; return (13 - (d.getMonth() + 1)) / 12; })();
          return cmpNum(ratioA, ratioB, sansDroitSortDir);
        }
        default:       return 0;
      }
    });

  // Retourne la couleur hex de la famille pour un code type de congé
  const getFamilleColor = (codeType: string): string | null => {
    const type = typesConge.find(t => t.code === codeType);
    if (!type?.code_famille) return null;
    return famillesConge.find(f => f.code === type.code_famille)?.couleur || null;
  };

  // Badge coloré selon la famille du type de congé
  const TypeCongeBadge = ({ code }: { code: string }) => {
    const libelle = getTypeLibelle(code);
    const couleur = getFamilleColor(code);
    const baseStyle: React.CSSProperties = couleur ? {
      borderColor: `${couleur}60`,
      backgroundColor: `${couleur}18`,
      color: couleur,
    } : {};
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors"
        style={baseStyle}
      >
        <span className="font-mono opacity-70">{code}</span>
        {libelle !== code && (
          <>
            <span className="opacity-40">·</span>
            <span>{libelle}</span>
          </>
        )}
      </span>
    );
  };

  return (
    <TooltipProvider>
    <div className="p-6 space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>
            Compteurs de Congés
          </h1>
          <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
            {isManager ? "Soldes et droits de votre équipe" : "Gestion des droits acquis, soldes et reliquats par collaborateur"}
          </p>
        </div>
        {!isManager && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => recalculAll.mutate()} disabled={recalculAll.isPending}>
              <RefreshCw size={15} className={recalculAll.isPending ? "animate-spin" : ""} />
              Recalculer les soldes
            </Button>
            {collabsSansDroits.length > 0 && (
              <Button variant="outline" size="sm"
                onClick={() => genererTousDroits.mutate()}
                disabled={genererTousDroits.isPending}
                className="border-amber-500/50 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950">
                <Wand2 size={15} className={genererTousDroits.isPending ? "animate-spin" : ""} />
                Générer droits manquants ({collabsSansDroits.length})
              </Button>
            )}
            <Button size="sm" onClick={openNewDroit}>
              <Plus size={15} /> Saisir un droit
            </Button>
          </div>
        )}
      </div>

      {/* Alerte collaborateurs sans droits — admin/RH uniquement */}
      {!isManager && collabsSansDroits.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 text-amber-500 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                {collabsSansDroits.length} collaborateur(s) sans droits pour l'exercice {filterExercice}
              </p>
              <p className="text-xs text-amber-600/80 dark:text-amber-500/80 mt-0.5">
                Les droits seront calculés proportionnellement à la date d'entrée (date début du contrat).
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Jours acquis", value: totalAcquis.toFixed(1), icon: <TrendingUp size={18} />, color: "hsl(var(--primary))" },
          { label: "Jours pris", value: totalPris.toFixed(1), icon: <CheckCircle size={18} />, color: "hsl(142 71% 45%)" },
          { label: "Solde restant", value: totalRest.toFixed(1), icon: <Clock size={18} />, color: "hsl(38 92% 50%)" },
          { label: "Reliquats reportés", value: totalReliq.toFixed(1), icon: <AlertTriangle size={18} />, color: "hsl(0 72% 51%)" },
        ].map(k => (
          <Card key={k.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ background: `${k.color}20`, color: k.color }}>
                {k.icon}
              </div>
              <div>
                <p className="text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>{k.value}</p>
                <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{k.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filtres */}
      <Card>
        <CardContent className="p-4">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
              <Input placeholder="Rechercher un collaborateur..." className="pl-9"
                value={searchCollab} onChange={e => setSearchCollab(e.target.value)} />
            </div>
            <Select value={filterExercice} onValueChange={setFilterExercice}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Exercice" /></SelectTrigger>
              <SelectContent>
                {exercices.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Type de congé" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tous les types</SelectItem>
                {typesConge.map(t => <SelectItem key={t.code} value={t.code}>{t.libelle}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Onglets Soldes / Droits / Sans droits */}
      <Tabs defaultValue="soldes">
        <TabsList>
          <TabsTrigger value="soldes">Soldes ({soldes.length})</TabsTrigger>
          <TabsTrigger value="droits">Droits acquis ({droits.length})</TabsTrigger>
          {!isManager && (
            <TabsTrigger value="sans-droits" className="relative">
              Sans droits
              {collabsSansDroits.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-xs w-5 h-5 font-bold">
                  {collabsSansDroits.length}
                </span>
              )}
            </TabsTrigger>
          )}
        </TabsList>

        {/* ─── Onglet Soldes ─── */}
        <TabsContent value="soldes">
          <Card>
            {/* Barre de filtre local + export */}
            <div className="px-4 pt-4 pb-2 flex items-center gap-2 border-b" style={{ borderColor: "hsl(var(--border))" }}>
              <Search size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
              <input
                type="text"
                value={soldeSearch}
                onChange={e => setSoldeSearch(e.target.value)}
                placeholder="Filtrer par collaborateur ou type de congé…"
                className="flex-1 text-sm bg-transparent outline-none"
                style={{ color: "hsl(var(--foreground))" }}
              />
              {soldeSearch && (
                <button onClick={() => setSoldeSearch("")} className="text-xs px-1.5 py-0.5 rounded hover:bg-muted"
                  style={{ color: "hsl(var(--muted-foreground))" }}>✕</button>
              )}
              <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                {soldesFiltered.length} / {soldes.length}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline" onClick={exportSoldes} className="gap-1.5 ml-1">
                    <Download size={13} /> Excel
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Exporter les soldes en Excel</TooltipContent>
              </Tooltip>
            </div>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead col="nom" label="Collaborateur" currentCol={soldeSortCol} currentDir={soldeSortDir} setCol={setSoldeSortCol} setDir={setSoldeSortDir} />
                    <SortableHead col="type" label="Type de congé" currentCol={soldeSortCol} currentDir={soldeSortDir} setCol={setSoldeSortCol} setDir={setSoldeSortDir} />
                    <SortableHead col="acquis" label="Acquis" currentCol={soldeSortCol} currentDir={soldeSortDir} setCol={setSoldeSortCol} setDir={setSoldeSortDir} className="text-right" />
                    <SortableHead col="pris" label="Pris" currentCol={soldeSortCol} currentDir={soldeSortDir} setCol={setSoldeSortCol} setDir={setSoldeSortDir} className="text-right" />
                    <SortableHead col="attente" label="En attente" currentCol={soldeSortCol} currentDir={soldeSortDir} setCol={setSoldeSortCol} setDir={setSoldeSortDir} className="text-right" />
                    <SortableHead col="reliquat" label="Reliquat" currentCol={soldeSortCol} currentDir={soldeSortDir} setCol={setSoldeSortCol} setDir={setSoldeSortDir} className="text-right" />
                    <SortableHead col="restant" label="Solde restant" currentCol={soldeSortCol} currentDir={soldeSortDir} setCol={setSoldeSortCol} setDir={setSoldeSortDir} className="text-right font-bold" />
                    <SortableHead col="maj" label="Maj le" currentCol={soldeSortCol} currentDir={soldeSortDir} setCol={setSoldeSortCol} setDir={setSoldeSortDir} className="text-xs" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {soldesLoading && (
                    <TableRow><TableCell colSpan={8} className="text-center py-8">Chargement...</TableCell></TableRow>
                  )}
                  {!soldesLoading && soldesFiltered.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>
                      Aucun solde trouvé
                    </TableCell></TableRow>
                  )}
                  {soldesFiltered.map(s => {
                    const restant = Number(s.solde_restant);
                    const restantColor = restant < 0 ? "hsl(0 72% 51%)" : restant < 3 ? "hsl(38 92% 50%)" : "hsl(142 71% 45%)";
                    return (
                      <TableRow key={s.id} className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedCollab(s.collaborateur_id)}>
                        <TableCell>
                          <div className="font-medium">{s.collaborateurs?.nom} {s.collaborateurs?.prenom}</div>
                          <div className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{s.collaborateurs?.matricule}</div>
                        </TableCell>
                        <TableCell>
                          <TypeCongeBadge code={s.code_type_conge} />
                        </TableCell>
                        <TableCell className="text-right">{Number(s.solde_acquis).toFixed(1)}</TableCell>
                        <TableCell className="text-right">{Number(s.solde_pris).toFixed(1)}</TableCell>
                        <TableCell className="text-right">
                          {Number(s.solde_en_attente) > 0 ? (
                            <span style={{ color: "hsl(38 92% 50%)" }}>{Number(s.solde_en_attente).toFixed(1)}</span>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {Number(s.reliquat_reporte) > 0 ? (
                              <span style={{ color: "hsl(var(--primary))" }} className="font-medium">
                                {Number(s.reliquat_reporte).toFixed(1)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                            {!isManager && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost" size="icon"
                                    className="h-6 w-6 opacity-40 hover:opacity-100"
                                    onClick={e => { e.stopPropagation(); openForcerReliquat(s); }}
                                  >
                                    <ArrowRightLeft size={11} />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Forcer le reliquat</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-bold text-lg" style={{ color: restantColor }}>{restant.toFixed(1)}</span>
                        </TableCell>
                        <TableCell className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                          {new Date(s.date_calcul).toLocaleDateString("fr-FR")}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Onglet Droits ─── */}
        <TabsContent value="droits">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Droits acquis — Exercice {filterExercice}</CardTitle>
                <div className="flex gap-2 items-center">
                  <Select value={selectedCollab || "ALL"} onValueChange={v => setSelectedCollab(v === "ALL" ? null : v)}>
                    <SelectTrigger className="w-64"><SelectValue placeholder="Tous les collaborateurs" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">Tous les collaborateurs</SelectItem>
                      {collaborateurs.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.nom} {c.prenom} ({c.matricule})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!isManager && (
                    <Button size="sm" onClick={openNewDroit}><Plus size={15} /> Nouveau</Button>
                  )}
                </div>
              </div>
            </CardHeader>
            {/* Barre de filtre local + export */}
            <div className="px-4 pb-3 flex items-center gap-2 border-b" style={{ borderColor: "hsl(var(--border))" }}>
              <Search size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
              <input
                type="text"
                value={droitSearch}
                onChange={e => setDroitSearch(e.target.value)}
                placeholder="Filtrer par collaborateur ou type de congé…"
                className="flex-1 text-sm bg-transparent outline-none"
                style={{ color: "hsl(var(--foreground))" }}
              />
              {droitSearch && (
                <button onClick={() => setDroitSearch("")} className="text-xs px-1.5 py-0.5 rounded hover:bg-muted"
                  style={{ color: "hsl(var(--muted-foreground))" }}>✕</button>
              )}
              <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                {droitsFiltered.length} / {droits.length}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline" onClick={exportDroits} className="gap-1.5 ml-1">
                    <Download size={13} /> Excel
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Exporter les droits en Excel</TooltipContent>
              </Tooltip>
            </div>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead col="nom" label="Collaborateur" currentCol={droitSortCol} currentDir={droitSortDir} setCol={setDroitSortCol} setDir={setDroitSortDir} />
                    <SortableHead col="type" label="Type de congé" currentCol={droitSortCol} currentDir={droitSortDir} setCol={setDroitSortCol} setDir={setDroitSortDir} />
                    <SortableHead col="debut" label="Période" currentCol={droitSortCol} currentDir={droitSortDir} setCol={setDroitSortCol} setDir={setDroitSortDir} />
                    <SortableHead col="jours" label="Jours acquis" currentCol={droitSortCol} currentDir={droitSortDir} setCol={setDroitSortCol} setDir={setDroitSortDir} className="text-right" />
                    <TableHead>Commentaire</TableHead>
                    <TableHead className="w-20">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {droitsLoading && (
                    <TableRow><TableCell colSpan={6} className="text-center py-8">Chargement...</TableCell></TableRow>
                  )}
                  {!droitsLoading && droitsFiltered.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>
                      Aucun droit saisi
                    </TableCell></TableRow>
                  )}
                  {droitsFiltered.map(d => {
                    const collab = collaborateurs.find(c => c.id === d.collaborateur_id);
                    return (
                      <TableRow key={d.id} className="cursor-pointer hover:bg-muted/50"
                        onClick={() => {
                          setHistoriqueTarget({
                            collaborateur_id: d.collaborateur_id,
                            nom: collab?.nom || "",
                            prenom: collab?.prenom || "",
                            matricule: collab?.matricule || "",
                            code_type_conge: d.code_type_conge,
                          });
                          setOpenHistoriqueDialog(true);
                        }}>
                        <TableCell className="font-medium">{getCollabLabel(d.collaborateur_id)}</TableCell>
                        <TableCell><TypeCongeBadge code={d.code_type_conge} /></TableCell>
                        <TableCell className="text-sm">
                          {new Date(d.periode_debut).toLocaleDateString("fr-FR")} → {new Date(d.periode_fin).toLocaleDateString("fr-FR")}
                        </TableCell>
                        <TableCell className="text-right font-bold">{Number(d.jours_acquis).toFixed(1)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {decodeComment(d.commentaire) || "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8"
                                  onClick={() => {
                                    setHistoriqueTarget({
                                      collaborateur_id: d.collaborateur_id,
                                      nom: collab?.nom || "",
                                      prenom: collab?.prenom || "",
                                      matricule: collab?.matricule || "",
                                      code_type_conge: d.code_type_conge,
                                    });
                                    setOpenHistoriqueDialog(true);
                                  }}>
                                  <History size={13} />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Historique des congés</TooltipContent>
                            </Tooltip>
                            {!isManager && (
                              <>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDroit(d)}><Edit size={13} /></Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteDroit.mutate(d.id)}
                                  style={{ color: "hsl(var(--destructive))" }}><Trash2 size={13} /></Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Onglet Sans droits ─── */}
        {!isManager && (
        <TabsContent value="sans-droits">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">
                    Collaborateurs sans droits — Exercice {filterExercice}
                  </CardTitle>
                  <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Les droits seront calculés au prorata de la date d'entrée (arrondi à 0,5 jour)
                  </p>
                </div>
                {collabsSansDroits.length > 0 && (
                  <Button size="sm" variant="outline"
                    onClick={() => genererTousDroits.mutate()}
                    disabled={genererTousDroits.isPending}
                    className="border-amber-500/50 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950">
                    <Wand2 size={15} className={genererTousDroits.isPending ? "animate-spin" : ""} />
                    Générer tous les droits manquants
                  </Button>
                )}
              </div>
            </CardHeader>
            {/* Barre de filtre local */}
            <div className="px-4 pb-3 flex items-center gap-2 border-b" style={{ borderColor: "hsl(var(--border))" }}>
              <Search size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
              <input
                type="text"
                value={sansDroitSearch}
                onChange={e => setSansDroitSearch(e.target.value)}
                placeholder="Filtrer par collaborateur ou type de contrat…"
                className="flex-1 text-sm bg-transparent outline-none"
                style={{ color: "hsl(var(--foreground))" }}
              />
              {sansDroitSearch && (
                <button onClick={() => setSansDroitSearch("")} className="text-xs px-1.5 py-0.5 rounded hover:bg-muted"
                  style={{ color: "hsl(var(--muted-foreground))" }}>✕</button>
              )}
              <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                {sansDroitsFiltered.length} / {collabsSansDroits.length}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline" onClick={exportSansDroits} className="gap-1.5 ml-1">
                    <Download size={13} /> Excel
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Exporter la liste sans droits en Excel</TooltipContent>
              </Tooltip>
            </div>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead col="nom" label="Collaborateur" currentCol={sansDroitSortCol} currentDir={sansDroitSortDir} setCol={setSansDroitSortCol} setDir={setSansDroitSortDir} />
                    <SortableHead col="type" label="Contrat" currentCol={sansDroitSortCol} currentDir={sansDroitSortDir} setCol={setSansDroitSortCol} setDir={setSansDroitSortDir} />
                    <TableHead>Types de congé manquants</TableHead>
                    <SortableHead col="entree" label="Date d'entrée" currentCol={sansDroitSortCol} currentDir={sansDroitSortDir} setCol={setSansDroitSortCol} setDir={setSansDroitSortDir} />
                    <SortableHead col="ratio" label={`Mois travaillés en ${filterExercice}`} currentCol={sansDroitSortCol} currentDir={sansDroitSortDir} setCol={setSansDroitSortCol} setDir={setSansDroitSortDir} />
                    <TableHead>Ratio prorata</TableHead>
                    <TableHead className="w-32 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sansDroitsFiltered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-10">
                        <div className="flex flex-col items-center gap-2">
                          <CheckCircle size={32} className="text-green-500" />
                          <p className="font-medium" style={{ color: "hsl(var(--foreground))" }}>
                            Tous les collaborateurs ont leurs droits pour {filterExercice}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  {sansDroitsFiltered.map(c => {
                    const dateEntree = c.date_debut_contrat ? new Date(c.date_debut_contrat) : null;
                    const anneeEntree = dateEntree ? dateEntree.getFullYear() : null;
                    const exerciceNum = Number(filterExercice);
                    let moisTravailles = 12;
                    let ratio = 1;
                    if (dateEntree && anneeEntree === exerciceNum) {
                      moisTravailles = 13 - (dateEntree.getMonth() + 1);
                      ratio = moisTravailles / 12;
                    } else if (dateEntree && anneeEntree! > exerciceNum) {
                      moisTravailles = 0;
                      ratio = 0;
                    }

                    // Types de congé manquants pour ce collaborateur
                    const typesCibles = typesConge.filter(t => {
                      const crit = t.population_criteres;
                      const eligible = !crit || crit.types_contrat.length === 0
                        ? true
                        : c.code_type_contrat
                          ? crit.types_contrat.includes(c.code_type_contrat)
                          : false;
                      if (!eligible) return false;
                      return !soldes.some(s => s.collaborateur_id === c.id && s.code_type_conge === t.code);
                    });

                    return (
                      <TableRow key={c.id}>
                        {/* Collaborateur */}
                        <TableCell>
                          <div className="font-medium">{c.nom} {c.prenom}</div>
                          <div className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{c.matricule}</div>
                        </TableCell>

                        {/* Type de contrat */}
                        <TableCell>
                          {c.code_type_contrat && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full font-medium border"
                              style={{
                                background: "hsl(var(--accent)/0.10)",
                                color: "hsl(var(--accent))",
                                borderColor: "hsl(var(--accent)/0.25)",
                              }}>
                              {c.code_type_contrat}
                            </span>
                          )}
                        </TableCell>

                        {/* Types de congé manquants avec badge coloré */}
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {typesCibles.slice(0, 4).map(t => (
                              <TypeCongeBadge key={t.code} code={t.code} />
                            ))}
                            {typesCibles.length > 4 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                                style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                                +{typesCibles.length - 4}
                              </span>
                            )}
                          </div>
                        </TableCell>

                        {/* Date d'entrée */}
                        <TableCell>
                          {dateEntree
                            ? <span className="text-sm">{dateEntree.toLocaleDateString("fr-FR")}</span>
                            : <span className="text-xs italic" style={{ color: "hsl(var(--muted-foreground))" }}>Non renseignée</span>
                          }
                        </TableCell>

                        {/* Barre de progression mois */}
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden w-24">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${ratio * 100}%` }} />
                            </div>
                            <span className="text-sm font-medium">{moisTravailles} mois</span>
                          </div>
                        </TableCell>

                        {/* Ratio */}
                        <TableCell>
                          <Badge variant={ratio >= 1 ? "default" : "secondary"}>
                            {(ratio * 100).toFixed(0)}%
                          </Badge>
                        </TableCell>

                        {/* Action */}
                        <TableCell className="text-right">
                          {c.date_debut_contrat ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="sm" variant="outline"
                                  disabled={generatingId === c.id || !c.date_debut_contrat}
                                  onClick={() => genererDroitsCollab(c.id, c.date_debut_contrat!)}>
                                  <Zap size={13} className={generatingId === c.id ? "animate-pulse" : ""} />
                                  {generatingId === c.id ? "En cours…" : "Générer"}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                Générer les droits au prorata ({moisTravailles} mois)
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-xs text-muted-foreground">Aucun contrat</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        )}
      </Tabs>

      {/* ─── Dialog Saisie Droit ─── */}
      <Dialog open={openDroitDialog} onOpenChange={setOpenDroitDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editDroit ? "Modifier le droit" : "Saisir un droit congé"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1">
              <Label>Collaborateur *</Label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Rechercher par nom ou matricule…"
                  value={searchDroitCollab}
                  onChange={e => !editDroit && setSearchDroitCollab(e.target.value)}
                  readOnly={!!editDroit}
                  className="w-full px-3 py-2 text-sm border rounded-md outline-none"
                  style={{
                    borderColor: "hsl(var(--border))",
                    background: editDroit ? "hsl(var(--muted)/0.5)" : "hsl(var(--background))",
                    color: "hsl(var(--foreground))",
                    cursor: editDroit ? "default" : "text",
                  }}
                />
                {searchDroitCollab && !editDroit && (
                  <button onClick={() => setSearchDroitCollab("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    ✕
                  </button>
                )}
              </div>
              {/* Liste filtrée — masquée en mode édition */}
              {!editDroit && <div className="border rounded-md overflow-auto max-h-44"
                style={{ borderColor: "hsl(var(--border))" }}>
                {collaborateurs
                  .filter(c => {
                    if (!searchDroitCollab) return true;
                    const term = searchDroitCollab.toLowerCase();
                    return (
                      c.nom.toLowerCase().includes(term) ||
                      c.prenom.toLowerCase().includes(term) ||
                      c.matricule.toLowerCase().includes(term)
                    );
                  })
                  .map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setDroitForm(f => ({ ...f, collaborateur_id: c.id }));
                        setSearchDroitCollab(`${c.nom} ${c.prenom} (${c.matricule})`);
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2"
                      style={{
                        background: droitForm.collaborateur_id === c.id ? "hsl(var(--accent)/0.15)" : undefined,
                        color: droitForm.collaborateur_id === c.id ? "hsl(var(--accent))" : "hsl(var(--foreground))",
                        fontWeight: droitForm.collaborateur_id === c.id ? 600 : 400,
                      }}>
                      <span className="font-mono text-xs px-1.5 py-0.5 rounded"
                        style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                        {c.matricule}
                      </span>
                      {c.nom} {c.prenom}
                      {droitForm.collaborateur_id === c.id && (
                        <span className="ml-auto text-xs" style={{ color: "hsl(var(--accent))" }}>✓</span>
                      )}
                    </button>
                  ))
                }
                {collaborateurs.filter(c => {
                  if (!searchDroitCollab) return true;
                  const term = searchDroitCollab.toLowerCase();
                  return c.nom.toLowerCase().includes(term) || c.prenom.toLowerCase().includes(term) || c.matricule.toLowerCase().includes(term);
                }).length === 0 && (
                  <p className="text-center py-4 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Aucun résultat pour « {searchDroitCollab} »
                  </p>
                )}
              </div>
              }
              {droitForm.collaborateur_id && !editDroit && (
                <p className="text-xs" style={{ color: "hsl(var(--accent))" }}>
                  ✓ Sélectionné : {collaborateurs.find(c => c.id === droitForm.collaborateur_id)?.nom} {collaborateurs.find(c => c.id === droitForm.collaborateur_id)?.prenom}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Type de congé *</Label>
              <Select value={droitForm.code_type_conge}
                onValueChange={v => setDroitForm(f => ({ ...f, code_type_conge: v }))}>
                <SelectTrigger><SelectValue placeholder="Sélectionner…" /></SelectTrigger>
                <SelectContent>
                  {typesConge.map(t => <SelectItem key={t.code} value={t.code}><span className="font-mono text-xs opacity-60 mr-1">{t.code}</span> {t.libelle}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>Exercice *</Label>
                <Select value={String(droitForm.exercice)}
                  onValueChange={v => setDroitForm(f => ({ ...f, exercice: Number(v) }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {exercices.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Période début *</Label>
                <Input type="date" value={droitForm.periode_debut}
                  onChange={e => setDroitForm(f => ({ ...f, periode_debut: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Période fin *</Label>
                <Input type="date" value={droitForm.periode_fin}
                  onChange={e => setDroitForm(f => ({ ...f, periode_fin: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Jours acquis *</Label>
              <Input type="number" step="0.5" min="0" value={droitForm.jours_acquis}
                onChange={e => setDroitForm(f => ({ ...f, jours_acquis: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div className="space-y-1">
              <Label>Commentaire</Label>
              <Input
                value={editDroit ? (decodeComment(droitForm.commentaire) ?? "") : droitForm.commentaire}
                onChange={e => setDroitForm(f => ({ ...f, commentaire: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDroitDialog(false)}>Annuler</Button>
            <Button onClick={() => saveDroit.mutate({ ...droitForm, ...(editDroit ? { id: editDroit.id } : {}) })}
              disabled={saveDroit.isPending || !droitForm.collaborateur_id || !droitForm.code_type_conge}>
              {saveDroit.isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Dialog Forcer le Reliquat ─── */}
      <Dialog open={openReliquatDialog} onOpenChange={setOpenReliquatDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft size={18} />
              Forcer le reliquat
            </DialogTitle>
            <DialogDescription>
              {reliquatTarget && (
                <span>
                  <strong>{reliquatTarget.collaborateurs?.nom} {reliquatTarget.collaborateurs?.prenom}</strong>
                  {" — "}
                  {getTypeLibelle(reliquatTarget.code_type_conge)}
                  {" — Exercice "}<strong>{filterExercice}</strong>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1">
              <Label>Jours de reliquat à reporter *</Label>
              <Input
                type="number" step="0.5" min="0"
                value={reliquatForm.jours_reliquat}
                onChange={e => setReliquatForm(f => ({ ...f, jours_reliquat: parseFloat(e.target.value) || 0 }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Exercice d'origine *</Label>
                <Select
                  value={String(reliquatForm.exercice_origine)}
                  onValueChange={v => setReliquatForm(f => ({ ...f, exercice_origine: Number(v) }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {exercices.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Date butoir *</Label>
                <Input
                  type="date"
                  value={reliquatForm.date_butoir}
                  onChange={e => setReliquatForm(f => ({ ...f, date_butoir: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Commentaire / motif</Label>
              <Textarea
                rows={2}
                placeholder="Ex : Report manuel suite à clôture d'exercice…"
                value={reliquatForm.commentaire}
                onChange={e => setReliquatForm(f => ({ ...f, commentaire: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenReliquatDialog(false)}>Annuler</Button>
            <Button
              onClick={() => forcerReliquat.mutate()}
              disabled={forcerReliquat.isPending || reliquatForm.jours_reliquat < 0 || !reliquatForm.date_butoir}
            >
              {forcerReliquat.isPending ? "Enregistrement…" : "Forcer le reliquat"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Dialog Historique des Congés ─── */}
      <Dialog open={openHistoriqueDialog} onOpenChange={v => { setOpenHistoriqueDialog(v); if (!v) setHistoriqueTarget(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History size={18} />
              Historique des congés
            </DialogTitle>
            {historiqueTarget && (
              <DialogDescription className="flex items-center gap-2 mt-1">
                <span className="font-semibold text-foreground">
                  {historiqueTarget.nom} {historiqueTarget.prenom}
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{historiqueTarget.matricule}</span>
                <span className="text-muted-foreground">·</span>
                <TypeCongeBadge code={historiqueTarget.code_type_conge} />
              </DialogDescription>
            )}
          </DialogHeader>

          <ScrollArea className="max-h-[60vh] pr-2">
            <Tabs defaultValue="consommations">
              <TabsList className="mb-4">
                <TabsTrigger value="consommations" className="flex items-center gap-1.5">
                  <CalendarDays size={14} />
                  Consommations ({histoConsommations.length})
                </TabsTrigger>
                <TabsTrigger value="demandes" className="flex items-center gap-1.5">
                  <FileCheck size={14} />
                  Demandes ({histoDemandes.length})
                </TabsTrigger>
              </TabsList>

              {/* ── Consommations ── */}
              <TabsContent value="consommations">
                {histoConsLoading ? (
                  <p className="text-center py-6 text-muted-foreground text-sm">Chargement…</p>
                ) : histoConsommations.length === 0 ? (
                  <p className="text-center py-10 text-muted-foreground text-sm">Aucune consommation enregistrée</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Exercice</TableHead>
                        <TableHead>Début</TableHead>
                        <TableHead>Retour</TableHead>
                        <TableHead className="text-right">Jours cal.</TableHead>
                        <TableHead className="text-right">Jours décomp.</TableHead>
                        <TableHead>Statut</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {histoConsommations.map(c => (
                        <TableRow key={c.id} className={c.est_annulee ? "opacity-50" : ""}>
                          <TableCell>
                            <Badge variant="secondary">{c.exercice}</Badge>
                          </TableCell>
                          <TableCell className="font-medium">
                            {new Date(c.date_debut).toLocaleDateString("fr-FR")}
                          </TableCell>
                          <TableCell>
                            {new Date(c.date_retour).toLocaleDateString("fr-FR")}
                          </TableCell>
                          <TableCell className="text-right">{c.nbr_jours_calendaires}</TableCell>
                          <TableCell className="text-right font-semibold">{c.nbr_jours_decomptes}</TableCell>
                          <TableCell>
                            {c.est_annulee ? (
                              <Badge variant="destructive" className="gap-1"><XCircle size={10} /> Annulée</Badge>
                            ) : (
                              <Badge className="gap-1 bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400">
                                <CheckCircle size={10} /> Validée
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>

              {/* ── Demandes ── */}
              <TabsContent value="demandes">
                {histoDemandesLoading ? (
                  <p className="text-center py-6 text-muted-foreground text-sm">Chargement…</p>
                ) : histoDemandes.length === 0 ? (
                  <p className="text-center py-10 text-muted-foreground text-sm">Aucune demande enregistrée</p>
                ) : (
                  <div className="space-y-3">
                    {histoDemandes.map(d => {
                      const statutConfig: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
                        APPROUVEE: { label: "Approuvée", icon: <CheckCircle size={11} />, cls: "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400" },
                        EN_ATTENTE: { label: "En attente", icon: <HourglassIcon size={11} />, cls: "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400" },
                        BROUILLON: { label: "Brouillon", icon: <Clock size={11} />, cls: "bg-muted text-muted-foreground" },
                        REFUSEE: { label: "Refusée", icon: <XCircle size={11} />, cls: "bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400" },
                        ANNULEE: { label: "Annulée", icon: <XCircle size={11} />, cls: "bg-muted text-muted-foreground" },
                      };
                      const sc = statutConfig[d.statut] || { label: d.statut, icon: null, cls: "bg-muted text-muted-foreground" };
                      return (
                        <div key={d.id} className="rounded-lg border p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">
                                {new Date(d.date_debut).toLocaleDateString("fr-FR")}
                                {" → "}
                                {new Date(d.date_fin_absence).toLocaleDateString("fr-FR")}
                              </span>
                              <span className="text-sm text-muted-foreground">
                                (retour le {new Date(d.date_retour).toLocaleDateString("fr-FR")})
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {d.nbr_jours_decomptes != null && (
                                <span className="text-sm font-semibold">{d.nbr_jours_decomptes} j décomptés</span>
                              )}
                              <Badge className={`gap-1 border ${sc.cls}`}>{sc.icon}{sc.label}</Badge>
                            </div>
                          </div>
                          {(d.commentaire_collaborateur || d.commentaire_gestionnaire) && (
                            <>
                              <Separator />
                              <div className="text-xs text-muted-foreground space-y-1">
                                {d.commentaire_collaborateur && (
                                  <p><span className="font-medium">Collaborateur :</span> {d.commentaire_collaborateur}</p>
                                )}
                                {d.commentaire_gestionnaire && (
                                  <p><span className="font-medium">Gestionnaire :</span> {d.commentaire_gestionnaire}</p>
                                )}
                              </div>
                            </>
                          )}
                          {d.date_soumission && (
                            <p className="text-xs text-muted-foreground">
                              Soumis le {new Date(d.date_soumission).toLocaleDateString("fr-FR")}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenHistoriqueDialog(false)}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  );
}

