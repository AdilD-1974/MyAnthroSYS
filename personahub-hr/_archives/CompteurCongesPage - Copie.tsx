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
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────
interface Collaborateur { id: string; matricule: string; nom: string; prenom: string; }
interface TypeConge { code: string; libelle: string; code_famille: string | null; }
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
    queryKey: ["collabs-avec-contrat", filterExercice, isManager, managerCollabIds],
    enabled: !isManager || !popLoading,
    queryFn: async () => {
      // RG-CONGE-COLLAB-01 : Récupérer les collaborateurs actifs avec leur contrat actif
      // On fait deux requêtes séparées pour éviter les ambiguïtés de FK Supabase
      let q = (supabase.from("collaborateurs" as never) as any)
        .select("id, matricule, nom, prenom")
        .eq("archive", false)
        .order("nom");
      if (isManager) {
        if (managerCollabIds.length === 0) return [];
        q = q.in("id", managerCollabIds);
      }
      const { data: collabs, error } = await q;
      if (error) throw error;

      // Récupérer les contrats actifs séparément
      const collabIds = (collabs || []).map((c: any) => c.id);
      if (collabIds.length === 0) return [];

      const { data: contrats } = await (supabase.from("collaborateur_contrats" as never) as any)
        .select("collaborateur_id, date_debut, date_sortie")
        .eq("archive", false)
        .is("date_sortie", null)
        .in("collaborateur_id", collabIds);

      const contratsMap = new Map<string, string>();
      (contrats || []).forEach((ct: any) => {
        if (!contratsMap.has(ct.collaborateur_id)) {
          contratsMap.set(ct.collaborateur_id, ct.date_debut);
        }
      });

      return (collabs || [])
        .filter((c: any) => contratsMap.has(c.id))
        .map((c: any) => ({
          id: c.id,
          matricule: c.matricule,
          nom: c.nom,
          prenom: c.prenom,
          date_debut_contrat: contratsMap.get(c.id) || null,
        }));
    },
  });

  const { data: typesConge = [] } = useQuery<TypeConge[]>({
    queryKey: ["ref-type-conge-actifs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ref_type_conge" as never)
        .select("code, libelle, code_famille")
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
      const data = []; const error = null; // Supabase desactive
      if (error) throw error;
      return data || [];
    },
  });

  // Demandes pour l'historique (tous exercices)
  const { data: histoDemandes = [], isLoading: histoDemandesLoading } = useQuery<DemandeRow[]>({
    queryKey: ["histo-demandes", historiqueTarget?.collaborateur_id, historiqueTarget?.code_type_conge],
    enabled: !!historiqueTarget,
    queryFn: async () => {
      const data = []; const error = null; // Supabase desactive
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
      const sansDroits = collabsAvecContrat.filter(
        c => !collabsAvecDroits.includes(c.id) && c.date_debut_contrat
      );
      let total = 0;
      for (const c of sansDroits) {
        const { data } = await supabase.rpc("generate_droits_proportionnels", {
          p_collaborateur_id: c.id,
          p_date_entree: c.date_debut_contrat!,
          p_exercice: Number(filterExercice),
        });
        total += (data as number) || 0;
      }
      return { nbCollabs: sansDroits.length, nbDroits: total };
    },
    onSuccess: ({ nbCollabs, nbDroits }) => {
      qc.invalidateQueries({ queryKey: ["cong-droits"] });
      qc.invalidateQueries({ queryKey: ["cong-soldes"] });
      qc.invalidateQueries({ queryKey: ["collabs-avec-droits"] });
      toast({
        title: `Génération terminée`,
        description: `${nbDroits} droit(s) créé(s) pour ${nbCollabs} collaborateur(s)`,
      });
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
      const data = []; const error = null; // Supabase desactive

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

  const collabsSansDroits = collabsAvecContrat.filter(c => !collabsAvecDroits.includes(c.id));
  const exercices = Array.from({ length: 5 }, (_, i) => String(EXERCICE_COURANT - 2 + i));
  const getTypeLibelle = (code: string) => typesConge.find(t => t.code === code)?.libelle || code;
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
      .replace(/entrÃ©e/g, "entrée").replace(/annuel/g, "annuel")
    : null;

  const getCollabLabel = (id: string) => {
    const c = collaborateurs.find(c => c.id === id);
    return c ? `${c.nom} ${c.prenom} (${c.matricule})` : id;
  };

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
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Collaborateur</TableHead>
                    <TableHead>Type de congé</TableHead>
                    <TableHead className="text-right">Acquis</TableHead>
                    <TableHead className="text-right">Pris</TableHead>
                    <TableHead className="text-right">En attente</TableHead>
                    <TableHead className="text-right">Reliquat</TableHead>
                    <TableHead className="text-right font-bold">Solde restant</TableHead>
                    <TableHead className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Maj le</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {soldesLoading && (
                    <TableRow><TableCell colSpan={8} className="text-center py-8">Chargement...</TableCell></TableRow>
                  )}
                  {!soldesLoading && soldes.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>
                      Aucun solde trouvé
                    </TableCell></TableRow>
                  )}
                  {soldes.map(s => {
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
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Collaborateur</TableHead>
                    <TableHead>Type de congé</TableHead>
                    <TableHead>Période</TableHead>
                    <TableHead className="text-right">Jours acquis</TableHead>
                    <TableHead>Commentaire</TableHead>
                    <TableHead className="w-20">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {droitsLoading && (
                    <TableRow><TableCell colSpan={6} className="text-center py-8">Chargement...</TableCell></TableRow>
                  )}
                  {!droitsLoading && droits.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>
                      Aucun droit saisi
                    </TableCell></TableRow>
                  )}
                  {droits.map(d => {
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

        {/* ─── Onglet Sans droits — masqué pour les managers ─── */}
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
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Collaborateur</TableHead>
                    <TableHead>Date d'entrée</TableHead>
                    <TableHead>Mois travaillés en {filterExercice}</TableHead>
                    <TableHead>Ratio prorata</TableHead>
                    <TableHead className="w-32 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {collabsSansDroits.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-10">
                        <div className="flex flex-col items-center gap-2">
                          <CheckCircle size={32} className="text-green-500" />
                          <p className="font-medium" style={{ color: "hsl(var(--foreground))" }}>
                            Tous les collaborateurs ont leurs droits pour {filterExercice}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  {collabsSansDroits.map(c => {
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
                    return (
                      <TableRow key={c.id}>
                        <TableCell>
                          <div className="font-medium">{c.nom} {c.prenom}</div>
                          <div className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{c.matricule}</div>
                        </TableCell>
                        <TableCell>
                          {dateEntree
                            ? <span className="text-sm">{dateEntree.toLocaleDateString("fr-FR")}</span>
                            : <span className="text-xs italic" style={{ color: "hsl(var(--muted-foreground))" }}>Non renseignée</span>
                          }
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden w-24">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${ratio * 100}%` }} />
                            </div>
                            <span className="text-sm font-medium">{moisTravailles} mois</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={ratio >= 1 ? "default" : "secondary"}>
                            {(ratio * 100).toFixed(0)}%
                          </Badge>
                        </TableCell>
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

