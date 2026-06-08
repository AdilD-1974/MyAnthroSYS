import React, { useState, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useManagerPopulation } from "@/hooks/useManagerPopulation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import {
  Plus, Search, Check, X, Edit, Eye, ChevronsUpDown,
  Clock, CheckCircle, XCircle, FileText, Send, TrendingUp, RefreshCw,
  RotateCcw, Calendar,
} from "lucide-react";
// RG-COMBOBOX-COLLAB-01 (Adil DAIA — 07/05/2026) : imports pour le Combobox de recherche
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

// ── Types ───────────────────────────────────────────────────
interface Collaborateur {
  id: string;
  matricule: string;
  nom: string;
  prenom: string;
  code_genre: string;
}

interface TypeConge {
  code: string;
  libelle: string;
  justificatif_obligatoire: boolean;
  population_criteres: Record<string, string[]> | null;
  code_type_jour: string | null; // CAL | OUV | OUV2
  // RG-CONGE-RECOND-01 (Adil DAIA)
  reconduction_autorisee: boolean;
  reconduction_max_nombre: number | null;
  reconduction_duree_jours: number | null;
  // RG-CONGE-REPRISE-01 (Adil DAIA)
  reprise_obligatoire: boolean;
  // RG-CONGE-RELIQUAT-INTERDIT-01 (Adil DAIA)
  interdit_reliquat: boolean;
  // RG-CONGE-AUTOABS-01 (Adil DAIA): Autorisation d'absence sans décompte solde
  est_autorisation_absence: boolean;
  droit_legal_jours: number | null;
  droit_convention_jours: number | null;
  droit_particulier_jours: number | null;
}

interface Demande {
  id: string;
  collaborateur_id: string;
  code_type_conge: string;
  date_debut: string;
  date_fin_absence: string;
  date_retour: string;
  debut_demi_journee: string | null;
  fin_demi_journee: string | null;
  nbr_jours_calendaires: number | null;
  nbr_jours_decomptes: number | null;
  statut: string;
  motif_refus: string | null;
  commentaire_collaborateur: string | null;
  commentaire_gestionnaire: string | null;
  est_report_reliquat: boolean;
  // RG-CONGE-RECOND-02 (Adil DAIA)
  reconduction_numero: number;
  demande_originale_id: string | null;
  // RG-CONGE-REPRISE-01 (Adil DAIA)
  date_reprise_effective: string | null;
  created_at: string;
  collaborateurs?: { nom: string; prenom: string; matricule: string };
}

interface Solde {
  solde_acquis: number;
  solde_pris: number;
  solde_en_attente: number;
  solde_restant: number;
  reliquat_reporte: number;
}

const STATUT_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  BROUILLON:  { label: "Brouillon",  color: "hsl(var(--muted-foreground))", icon: <FileText size={13} /> },
  EN_ATTENTE: { label: "En attente", color: "hsl(38 92% 50%)",              icon: <Clock size={13} /> },
  APPROUVEE:  { label: "Approuvée",  color: "hsl(142 71% 45%)",             icon: <CheckCircle size={13} /> },
  REFUSEE:    { label: "Refusée",    color: "hsl(0 72% 51%)",               icon: <XCircle size={13} /> },
  ANNULEE:    { label: "Annulée",    color: "hsl(var(--muted-foreground))", icon: <X size={13} /> },
  MODIFIEE:   { label: "Modifiée",   color: "hsl(var(--primary))",          icon: <Edit size={13} /> },
};

const EMPTY_FORM = {
  collaborateur_id: "", code_type_conge: "",
  date_debut: "", date_fin_absence: "", date_retour: "",
  debut_demi_journee: "", fin_demi_journee: "",
  nbr_jours_calendaires: 0, nbr_jours_decomptes: 0,
  commentaire_collaborateur: "", est_report_reliquat: false,
};

// ── Helpers calcul jours ─────────────────────────────────────

/** Détermine si une date est un jour férié parmi la liste fournie */
function isJourFerie(date: Date, feriesDates: Set<string>): boolean {
  return feriesDates.has(date.toISOString().split("T")[0]);
}

/** Jours de semaine OUV = lun-sam (0=dim exclu), OUV2 = lun-ven */
function isJourOuvre(date: Date, typeJour: string): boolean {
  const dow = date.getDay(); // 0=dim
  if (typeJour === "OUV2") return dow >= 1 && dow <= 5; // lun-ven
  return dow !== 0; // lun-sam
}

/**
 * Calcule les jours calendaires bruts et les jours décomptés selon le type de jour.
 * - CAL : tous les jours (y compris fériés)
 * - OUV : lun-sam hors fériés
 * - OUV2 : lun-ven hors fériés
 */
function calcJoursAvecType(
  debut: string, fin: string,
  debutDemi: string, finDemi: string,
  typeJour: string | null,
  feriesDates: Set<string>
): { cal: number; dec: number } {
  if (!debut || !fin) return { cal: 0, dec: 0 };
  const d1 = new Date(debut + "T00:00:00");
  const d2 = new Date(fin + "T00:00:00");
  if (d2 < d1) return { cal: 0, dec: 0 };

  // Jours calendaires bruts (inclut demi-journées)
  let cal = Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1;
  if (debutDemi === "APRES_MIDI") cal -= 0.5;
  if (finDemi === "MATIN") cal -= 0.5;

  // Jours décomptés selon type_jour
  const tj = typeJour || "CAL";
  if (tj === "CAL") {
    return { cal, dec: cal };
  }

  // Compter jour par jour (OUV / OUV2)
  let dec = 0;
  const cursor = new Date(d1);
  while (cursor <= d2) {
    const dateStr = cursor.toISOString().split("T")[0];
    if (isJourOuvre(cursor, tj) && !isJourFerie(cursor, feriesDates)) {
      dec += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  // Ajustements demi-journées sur les bornes
  if (debutDemi === "APRES_MIDI") {
    if (isJourOuvre(d1, tj) && !isJourFerie(d1, feriesDates)) dec -= 0.5;
  }
  if (finDemi === "MATIN") {
    if (isJourOuvre(d2, tj) && !isJourFerie(d2, feriesDates)) dec -= 0.5;
  }

  dec = Math.max(0, dec);
  return { cal, dec };
}

/**
 * RG-CONGE-AUTOABS-02 (Adil DAIA): Pour les autorisations d'absence,
 * calcule automatiquement date_fin_absence à partir de date_debut + droit légal (jours calendaires).
 * La date de retour est ensuite calculée normalement depuis date_fin.
 */
function calcDateFinAutoAbsence(debut: string, droitJours: number): string {
  if (!debut || droitJours <= 0) return debut;
  const [y, m, d] = debut.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + droitJours - 1); // -1 car le jour de début compte
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Calcule la date de retour.
 * - fin_demi_journee = "MATIN"  → retour l'après-midi du même jour = date_fin_absence
 * - tous les autres cas          → retour le lendemain = date_fin_absence + 1 jour
 *
 * Utilise une arithmétique purement sur les parties YYYY-MM-DD pour éviter
 * les décalages de fuseau horaire (UTC vs local).
 */
function calcDateRetour(fin: string, finDemi: string): string {
  if (!fin) return "";
  if (finDemi === "MATIN") return fin; // retour après-midi = même jour
  // Arithmétique fuseau-safe : décomposer la date ISO pour ne pas subir UTC offset
  const [y, m, d] = fin.split("-").map(Number);
  const dt = new Date(y, m - 1, d); // date locale, pas UTC
  dt.setDate(dt.getDate() + 1);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// ── Composant principal ──────────────────────────────────────
export default function SaisieCongesPage() {
  const qc = useQueryClient();
  const { role, profile } = useAuth();
  const isManager = role === "manager";
  const { collaborateurIds: managerCollabIds, loading: popLoading } = useManagerPopulation();
  // RG-COMBOBOX-COLLAB-01 : état d'ouverture du sélecteur de collaborateur recherchable
  const [openCollabPicker, setOpenCollabPicker] = useState(false);

  const [search, setSearch] = useState("");
  const [filterStatut, setFilterStatut] = useState("ALL");
  const [filterType, setFilterType] = useState("ALL");
  const [openForm, setOpenForm] = useState(false);
  const [openDetail, setOpenDetail] = useState(false);
  const [openRefus, setOpenRefus] = useState(false);
  const [selected, setSelected] = useState<Demande | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [motifRefus, setMotifRefus] = useState("");
  const [commentaireGest, setCommentaireGest] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [urlParamHandled, setUrlParamHandled] = useState(false);

  const exercice = new Date().getFullYear();



  // ── Données ──────────────────────────────────────────────
  // RG-MGR-POP-01 : Le manager ne peut saisir des congés que pour sa population
  const { data: collaborateurs = [] } = useQuery<Collaborateur[]>({
    queryKey: ["collaborateurs-actifs-genre", isManager, managerCollabIds.join(",")],
    enabled: !isManager || !popLoading,
    queryFn: async () => {
      let q = supabase
        .from("collaborateurs")
        .select("id, matricule, nom, prenom, code_genre")
        .eq("archive", false)
        .eq("statut_collaborateur", "ACTIF")
        .order("nom");
      if (isManager && managerCollabIds.length > 0) {
        q = q.in("id", managerCollabIds);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as Collaborateur[];
    },
  });

  // Types de congé : RG-CONGE-FIX-02 (Adil DAIA — 07/05/2026)
  //
  // ⚠️ INCOHÉRENCE DE SCHÉMA détectée :
  //   - L'ancienne table `types_conge` (UUID) est vide.
  //   - La nouvelle `ref_type_conge` (PK = code text) contient toutes les définitions
  //     enrichies (interdit_reliquat, reprise_obligatoire, reconduction_*, etc.).
  // → On lit ref_type_conge et on mappe `code` sur `id` pour rester compatible
  //   avec l'interface TypeConge existante.
  const { data: typesConge = [] } = useQuery<TypeConge[]>({
    queryKey: ["ref-type-conge-avec-criteres-v3"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ref_type_conge" as never)
        .select("*" as never)
        .eq("actif" as never, true as never)
        .order("ordre" as never, { ascending: true });
      if (error) throw error;
      // Compatibilité : id ← code (la PK est le code text, pas un UUID)
      return ((data || []) as any[]).map(r => ({ ...r, id: r.code })) as TypeConge[];
    },
  });

  // Jours fériés de l'année en cours (et suivante pour les congés à cheval)
  // RG-CONGE-DECOMPTE-01 : table ref_jours_feries (date_debut + nombre_jours)
  // RG-CONGE-FIX-01 (Adil DAIA — 07/05/2026) : branchement sur ref_jours_feries
  const { data: feriesSet = new Set<string>() } = useQuery<Set<string>>({
    queryKey: ["jours-feries-calcul-v2", exercice],
    queryFn: async () => {
      const { data } = await supabase
        .from("ref_jours_feries" as never)
        .select("date_debut,nombre_jours" as never)
        .gte("date_debut" as never, `${exercice}-01-01` as never)
        .lte("date_debut" as never, `${exercice + 1}-12-31` as never);
      const s = new Set<string>();
      ((data || []) as any[]).forEach((r: { date_debut: string; nombre_jours: number | null }) => {
        const nb = r.nombre_jours ?? 1;
        const d = new Date(r.date_debut + "T00:00:00");
        for (let i = 0; i < nb; i++) {
          const cur = new Date(d);
          cur.setDate(cur.getDate() + i);
          s.add(cur.toISOString().split("T")[0]);
        }
      });
      return s;
    },
  });

  // ── Pré-sélection collaborateur via URL (?collaborateur=UUID) ──
  useEffect(() => {
    if (urlParamHandled) return;
    const params = new URLSearchParams(window.location.search);
    const collabParam = params.get("collaborateur");
    if (collabParam && collaborateurs.length > 0) {
      const found = collaborateurs.find(c => c.id === collabParam);
      if (found) {
        setForm(f => ({ ...f, collaborateur_id: collabParam }));
        setOpenForm(true);
        setUrlParamHandled(true);
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  }, [collaborateurs, urlParamHandled]);


  // RG-CONGE-SOLDE-FIX-02 (Adil DAIA — 07/05/2026)
  // Source des soldes : table cong_solde (pré-calculée — alimentée par "Recalculer les soldes")
  // qui contient déjà solde_acquis / solde_pris / solde_en_attente / solde_restant / reliquat_reporte.
  // Index UNIQUE sur (collaborateur_id, code_type_conge, exercice) → maybeSingle() OK.
  const { data: soldeForm } = useQuery<Solde | null>({
    queryKey: ["cong-solde-form", form.collaborateur_id, form.code_type_conge, exercice],
    enabled: !!form.collaborateur_id && !!form.code_type_conge,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cong_solde" as never)
        .select("solde_acquis,solde_pris,solde_en_attente,solde_restant,reliquat_reporte" as never)
        .eq("collaborateur_id" as never, form.collaborateur_id as never)
        .eq("code_type_conge" as never, form.code_type_conge as never)
        .eq("exercice" as never, exercice as never)
        .eq("archive" as never, false as never)
        .maybeSingle();
      if (error || !data) return null;
      const c = data as any;
      return {
        solde_acquis: Number(c.solde_acquis ?? 0),
        solde_pris: Number(c.solde_pris ?? 0),
        solde_en_attente: Number(c.solde_en_attente ?? 0),
        solde_restant: Number(c.solde_restant ?? 0),
        reliquat_reporte: Number(c.reliquat_reporte ?? 0),
      } as Solde;
    },
  });

  const typeCongeActif = useMemo(() => {
    if (!form.code_type_conge) return null;
    return typesConge.find(t => t.code === form.code_type_conge) || null;
  }, [form.code_type_conge, typesConge]);

  // RG-CONGE-AUTOABS-02 (Adil DAIA): type autorisation d'absence → calcul auto date fin
  const isAutoAbsence = useMemo(() => !!typeCongeActif?.est_autorisation_absence, [typeCongeActif]);
  const droitAutoAbsence = useMemo(() => {
    if (!typeCongeActif?.est_autorisation_absence) return 0;
    return typeCongeActif.droit_convention_jours ?? typeCongeActif.droit_legal_jours ?? 0;
  }, [typeCongeActif]);

  // RG-CONGE-RELIQUAT-INTERDIT-01 (Adil DAIA): solde disponible réel = restant - déjà en attente
  const soldeDisponibleControle = useMemo(() => {
    if (!typeCongeActif?.interdit_reliquat) return null;
    return Number(soldeForm?.solde_restant ?? 0) - Number(soldeForm?.solde_en_attente ?? 0);
  }, [typeCongeActif, soldeForm]);

  // Genre du collaborateur sélectionné
  const codeGenreCollabSelectionne = useMemo(() => {
    if (!form.collaborateur_id) return null;
    return collaborateurs.find(c => c.id === form.collaborateur_id)?.code_genre || null;
  }, [form.collaborateur_id, collaborateurs]);

  // Types filtrés par genre (RG-CONGE-GENRE-01)
  const typesCongeDisponibles = useMemo(() => {
    if (!codeGenreCollabSelectionne) return typesConge;
    return typesConge.filter(t => {
      const genresAutorise = t.population_criteres?.code_genre;
      if (!genresAutorise || genresAutorise.length === 0) return true;
      return genresAutorise.includes(codeGenreCollabSelectionne);
    });
  }, [typesConge, codeGenreCollabSelectionne]);

  // code_type_jour du type de congé sélectionné
  const typeJourActif = useMemo(() => typeCongeActif?.code_type_jour || null, [typeCongeActif]);

  const { data: demandes = [], isLoading } = useQuery<Demande[]>({
    queryKey: ["cong-demandes", filterStatut, filterType, search, isManager, managerCollabIds.join(",")],
    enabled: !isManager || !popLoading,
    queryFn: async () => {
      // RG-MGR-POP-01 : Le manager voit les demandes de sa population
      if (isManager && managerCollabIds.length === 0) return [];

      let q = supabase
        .from("cong_demandes")
        .select("*, collaborateurs(nom, prenom, matricule)")
        .eq("archive", false)
        .order("created_at", { ascending: false });
      if (filterStatut !== "ALL") q = q.eq("statut", filterStatut);
      if (filterType !== "ALL") q = q.eq("code_type_conge", filterType);
      // Filtrer par population du manager
      if (isManager) q = q.in("collaborateur_id", managerCollabIds);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).filter((d: Demande) => {
        if (!search) return true;
        const c = d.collaborateurs;
        const t = search.toLowerCase();
        return c?.nom?.toLowerCase().includes(t) || c?.prenom?.toLowerCase().includes(t) || c?.matricule?.toLowerCase().includes(t);
      });
    },
  });

  // ── Mise à jour formulaire avec recalcul ──────────────────
  const updateFormDates = (updates: Partial<typeof form>) => {
    const merged = { ...form, ...updates };
    const { cal, dec } = calcJoursAvecType(
      merged.date_debut, merged.date_fin_absence,
      merged.debut_demi_journee, merged.fin_demi_journee,
      typeJourActif,
      feriesSet
    );
    const retour = calcDateRetour(merged.date_fin_absence, merged.fin_demi_journee);
    setForm(f => ({ ...f, ...updates, nbr_jours_calendaires: cal, nbr_jours_decomptes: dec, date_retour: retour }));
  };

  // Recalcul quand le type de congé change (code_type_jour peut changer)
  const handleTypeCongeChange = (code: string) => {
    const tc = typesConge.find(t => t.code === code);
    const newTypeJour = tc?.code_type_jour || null;
    const isAutoAbs = !!tc?.est_autorisation_absence;
    const droit = tc?.droit_convention_jours ?? tc?.droit_legal_jours ?? 0;

    // RG-CONGE-AUTOABS-02 : auto-calcul date fin si autorisation d'absence et date_debut déjà remplie
    let newDateFin = form.date_fin_absence;
    if (isAutoAbs && droit > 0 && form.date_debut) {
      newDateFin = calcDateFinAutoAbsence(form.date_debut, droit);
    }
    const { cal, dec } = calcJoursAvecType(
      form.date_debut, newDateFin,
      form.debut_demi_journee, form.fin_demi_journee,
      newTypeJour, feriesSet
    );
    const retour = calcDateRetour(newDateFin, form.fin_demi_journee);
    setForm(f => ({ ...f, code_type_conge: code, date_fin_absence: newDateFin, nbr_jours_calendaires: cal, nbr_jours_decomptes: dec, date_retour: retour }));
  };

  // RG-CONGE-AUTOABS-02 : quand date_debut change sur une autorisation d'absence → recalcul auto date fin
  const handleDateDebutAutoAbs = (dateDebut: string) => {
    if (!isAutoAbsence || droitAutoAbsence <= 0) {
      updateFormDates({ date_debut: dateDebut });
      return;
    }
    const newDateFin = calcDateFinAutoAbsence(dateDebut, droitAutoAbsence);
    const { cal, dec } = calcJoursAvecType(
      dateDebut, newDateFin, form.debut_demi_journee, form.fin_demi_journee,
      typeJourActif, feriesSet
    );
    const retour = calcDateRetour(newDateFin, form.fin_demi_journee);
    setForm(f => ({ ...f, date_debut: dateDebut, date_fin_absence: newDateFin, nbr_jours_calendaires: cal, nbr_jours_decomptes: dec, date_retour: retour }));
  };

  // ── Mutations ─────────────────────────────────────────────
  const saveDemande = useMutation({
    mutationFn: async () => {
      if (typeCongeActif?.interdit_reliquat) {
        const disponible = Number(soldeDisponibleControle ?? 0);
        if (form.nbr_jours_decomptes > disponible) {
          throw new Error(`Solde insuffisant : ${form.nbr_jours_decomptes.toFixed(1)}j demandés pour ${disponible.toFixed(1)}j disponibles.`);
        }
      }

      // RG-CONGE-CHEVAUCHE-01 (Adil DAIA) : Contrôle de chevauchement de périodes
      {
        let overlapQ = supabase
          .from("cong_demandes")
          .select("id, date_debut, date_fin_absence, code_type_conge, statut")
          .eq("collaborateur_id", form.collaborateur_id)
          .in("statut", ["EN_ATTENTE", "APPROUVEE", "BROUILLON"])
          .lte("date_debut", form.date_fin_absence)
          .gte("date_fin_absence", form.date_debut);

        if (editMode && selected) {
          overlapQ = overlapQ.neq("id", selected.id);
        }

        const { data: overlaps } = await overlapQ;
        if (overlaps && overlaps.length > 0) {
          const ov = overlaps[0];
          const ovType = typesConge.find(t => t.code === ov.code_type_conge);
          throw new Error(
            `Chevauchement détecté : une demande "${ovType?.libelle || ov.code_type_conge}" ` +
            `du ${new Date(ov.date_debut).toLocaleDateString("fr-FR")} au ${new Date(ov.date_fin_absence).toLocaleDateString("fr-FR")} ` +
            `existe déjà (statut : ${ov.statut}).`
          );
        }
      }

      const payload = {
        collaborateur_id: form.collaborateur_id,
        code_type_conge: form.code_type_conge,
        date_debut: form.date_debut,
        date_fin_absence: form.date_fin_absence,
        date_retour: form.date_retour,
        debut_demi_journee: form.debut_demi_journee || null,
        fin_demi_journee: form.fin_demi_journee || null,
        nbr_jours_calendaires: form.nbr_jours_calendaires,
        nbr_jours_decomptes: form.nbr_jours_decomptes,
        commentaire_collaborateur: form.commentaire_collaborateur || null,
        est_report_reliquat: form.est_report_reliquat,
        statut: "EN_ATTENTE", // 10 chars — fits VARCHAR(10)
        date_soumission: new Date().toISOString().split('T')[0], // VARCHAR(10) = date only YYYY-MM-DD
      };
      if (editMode && selected) {
        const { error } = await supabase.from("cong_demandes")
          .update({ ...payload, statut: "MODIFIEE", demande_originale_id: selected.id })
          .eq("id", selected.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("cong_demandes").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cong-demandes"] });
      toast({ title: editMode ? "Demande modifiée" : "Demande soumise avec succès" });
      setOpenForm(false);
    },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const approuver = useMutation({
    mutationFn: async (d: Demande) => {
      const { error } = await supabase.from("cong_demandes").update({
        statut: "APPROUVEE",
        date_validation: new Date().toISOString(),
        commentaire_gestionnaire: commentaireGest || null,
      }).eq("id", d.id);
      if (error) throw error;
      const { error: e2 } = await supabase.from("cong_consommation").insert({
        collaborateur_id: d.collaborateur_id,
        code_type_conge: d.code_type_conge,
        demande_id: d.id,
        date_debut: d.date_debut,
        date_retour: d.date_retour,
        nbr_jours_calendaires: d.nbr_jours_calendaires || 0,
        nbr_jours_decomptes: d.nbr_jours_decomptes || 0,
        debut_demi_journee: d.debut_demi_journee,
        fin_demi_journee: d.fin_demi_journee,
        exercice: new Date(d.date_debut).getFullYear(),
      });
      if (e2) throw e2;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cong-demandes"] });
      qc.invalidateQueries({ queryKey: ["cong-soldes"] });
      qc.invalidateQueries({ queryKey: ["cong-solde-form"] });
      toast({ title: "Demande approuvée et congé enregistré" });
      setOpenDetail(false);
    },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const refuser = useMutation({
    mutationFn: async (d: Demande) => {
      const { error } = await supabase.from("cong_demandes").update({
        statut: "REFUSEE",
        motif_refus: motifRefus,
        commentaire_gestionnaire: commentaireGest || null,
        date_validation: new Date().toISOString(),
      }).eq("id", d.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cong-demandes"] });
      toast({ title: "Demande refusée" });
      setOpenRefus(false);
      setOpenDetail(false);
    },
  });

  const annuler = useMutation({
    mutationFn: async (d: Demande) => {
      const { error } = await supabase.from("cong_demandes")
        .update({ statut: "ANNULEE" }).eq("id", d.id);
      if (error) throw error;
      await supabase.from("cong_consommation").update({
        est_annulee: true, date_annulation: new Date().toISOString(), motif_annulation: "Annulation demande",
      }).eq("demande_id", d.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cong-demandes"] });
      qc.invalidateQueries({ queryKey: ["cong-soldes"] });
      qc.invalidateQueries({ queryKey: ["cong-solde-form"] });
      toast({ title: "Demande annulée" });
      setOpenDetail(false);
    },
  });

  // RG-CONGE-RECOND-01 (Adil DAIA): Reconduction d'un congé approuvé
  // La durée configurée dans le type est le MAXIMUM; l'utilisateur saisit le nombre de jours souhaité.
  const [recondDialog, setRecondDialog] = useState<{ open: boolean; demande: Demande | null; jours: number; max: number }>({ open: false, demande: null, jours: 1, max: 30 });

  const openRecondDialog = (d: Demande) => {
    const tc = typesConge.find(t => t.code === d.code_type_conge);
    if (!tc?.reconduction_autorisee) return;
    const maxJours = tc.reconduction_duree_jours || 30;
    setRecondDialog({ open: true, demande: d, jours: maxJours, max: maxJours });
  };

  const reconduire = useMutation({
    mutationFn: async ({ demande, jours }: { demande: Demande; jours: number }) => {
      const tc = typesConge.find(t => t.code === demande.code_type_conge);
      if (!tc?.reconduction_autorisee) throw new Error("Reconduction non autorisée pour ce type.");
      if (tc.reconduction_max_nombre != null && demande.reconduction_numero >= tc.reconduction_max_nombre) {
        throw new Error(`Nombre maximum de reconductions atteint (${tc.reconduction_max_nombre}).`);
      }
      if (jours < 1 || jours > (tc.reconduction_duree_jours || 30)) {
        throw new Error(`Le nombre de jours doit être entre 1 et ${tc.reconduction_duree_jours || 30}.`);
      }
      const newDebut = demande.date_retour;
      const [y, m, dd] = newDebut.split("-").map(Number);
      const finDate = new Date(y, m - 1, dd);
      finDate.setDate(finDate.getDate() + jours - 1);
      const newFin = `${finDate.getFullYear()}-${String(finDate.getMonth() + 1).padStart(2, "0")}-${String(finDate.getDate()).padStart(2, "0")}`;
      const retourDate = new Date(finDate);
      retourDate.setDate(retourDate.getDate() + 1);
      const newRetour = `${retourDate.getFullYear()}-${String(retourDate.getMonth() + 1).padStart(2, "0")}-${String(retourDate.getDate()).padStart(2, "0")}`;

      const { error } = await supabase.from("cong_demandes").insert({
        collaborateur_id: demande.collaborateur_id,
        code_type_conge: demande.code_type_conge,
        date_debut: newDebut,
        date_fin_absence: newFin,
        date_retour: newRetour,
        nbr_jours_calendaires: jours,
        nbr_jours_decomptes: jours,
        statut: "EN_ATTENTE", // 10 chars — fits VARCHAR(10)
        date_soumission: new Date().toISOString().split('T')[0], // VARCHAR(10) = date only YYYY-MM-DD
        reconduction_numero: demande.reconduction_numero + 1,
        demande_originale_id: demande.demande_originale_id || demande.id,
        commentaire_collaborateur: `Reconduction n°${demande.reconduction_numero + 1} du congé initial (${jours} jours)`,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cong-demandes"] });
      toast({ title: "Reconduction soumise avec succès" });
      setOpenDetail(false);
      setRecondDialog({ open: false, demande: null, jours: 1, max: 30 });
    },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  // RG-CONGE-REPRISE-01 (Adil DAIA): Enregistrer la date de reprise effective
  const enregistrerReprise = useMutation({
    mutationFn: async ({ demandeId, dateReprise }: { demandeId: string; dateReprise: string }) => {
      const { error } = await supabase.from("cong_demandes")
        .update({ date_reprise_effective: dateReprise })
        .eq("id", demandeId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cong-demandes"] });
      toast({ title: "Date de reprise enregistrée" });
    },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const [dateRepriseInput, setDateRepriseInput] = useState("");

  const openNew = () => {
    setEditMode(false);
    setForm(EMPTY_FORM);
    setOpenForm(true);
  };

  const openEdit = (d: Demande) => {
    setEditMode(true);
    setSelected(d);
    setForm({
      collaborateur_id: d.collaborateur_id,
      code_type_conge: d.code_type_conge,
      date_debut: d.date_debut,
      date_fin_absence: d.date_fin_absence,
      date_retour: d.date_retour,
      debut_demi_journee: d.debut_demi_journee || "",
      fin_demi_journee: d.fin_demi_journee || "",
      nbr_jours_calendaires: d.nbr_jours_calendaires || 0,
      nbr_jours_decomptes: d.nbr_jours_decomptes || 0,
      commentaire_collaborateur: d.commentaire_collaborateur || "",
      est_report_reliquat: d.est_report_reliquat,
    });
    setOpenForm(true);
  };

  const getTypeLibelle = (code: string) =>
    (typesConge as any[]).find(t => t.code === code)?.libelle || code;

  const StatutBadge = ({ statut }: { statut: string }) => {
    const cfg = STATUT_CONFIG[statut] || STATUT_CONFIG["BROUILLON"];
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
        style={{ background: `${cfg.color}20`, color: cfg.color }}>
        {cfg.icon} {cfg.label}
      </span>
    );
  };

  // Label du type de calendrier pour affichage
  const typeJourLabel = (tj: string | null) => {
    if (tj === "OUV")  return "Ouvrés (lun-sam)";
    if (tj === "OUV2") return "Ouvrables (lun-ven)";
    return "Calendaires";
  };

  return (
    <div className="p-6 space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>Saisie & Gestion des Congés</h1>
          <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
            Demandes, approbations, refus, annulations et modifications
          </p>
        </div>
        <Button onClick={openNew}><Plus size={15} className="mr-1" /> Nouvelle demande</Button>
      </div>

      {/* Statistiques rapides */}
      <div className="grid grid-cols-5 gap-3">
        {Object.entries(STATUT_CONFIG).map(([key, cfg]) => {
          const count = demandes.filter(d => d.statut === key).length;
          return (
            <Card key={key} className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setFilterStatut(filterStatut === key ? "ALL" : key)}
              style={{ borderColor: filterStatut === key ? cfg.color : undefined }}>
              <CardContent className="p-3 flex items-center gap-2">
                <span style={{ color: cfg.color }}>{cfg.icon}</span>
                <div>
                  <div className="text-lg font-bold" style={{ color: "hsl(var(--foreground))" }}>{count}</div>
                  <div className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{cfg.label}</div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filtres */}
      <Card>
        <CardContent className="p-4 flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
            <Input placeholder="Rechercher un collaborateur…" className="pl-9"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={filterStatut} onValueChange={setFilterStatut}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Statut" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tous les statuts</SelectItem>
              {Object.entries(STATUT_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Type de congé" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tous les types</SelectItem>
              {typesConge.map((t) => <SelectItem key={t.code} value={t.code}>{t.libelle}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Collaborateur</TableHead>
                <TableHead>Type de congé</TableHead>
                <TableHead>Début</TableHead>
                <TableHead>Fin absence</TableHead>
                <TableHead>Date retour</TableHead>
                <TableHead className="text-right">J. cal.</TableHead>
                <TableHead className="text-right">J. décomptés</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Soumis le</TableHead>
                <TableHead className="w-28">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={10} className="text-center py-8">Chargement…</TableCell></TableRow>
              )}
              {!isLoading && demandes.length === 0 && (
                <TableRow><TableCell colSpan={10} className="text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Aucune demande trouvée
                </TableCell></TableRow>
              )}
              {demandes.map(d => (
                <TableRow key={d.id}>
                  <TableCell>
                    <div className="font-medium">{d.collaborateurs?.nom} {d.collaborateurs?.prenom}</div>
                    <div className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{d.collaborateurs?.matricule}</div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{getTypeLibelle(d.code_type_conge)}</Badge></TableCell>
                  <TableCell className="text-sm">
                    {new Date(d.date_debut).toLocaleDateString("fr-FR")}
                    {d.debut_demi_journee && <div className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{d.debut_demi_journee === "MATIN" ? "Matin" : "Après-midi"}</div>}
                  </TableCell>
                  <TableCell className="text-sm">
                    {new Date(d.date_fin_absence).toLocaleDateString("fr-FR")}
                    {d.fin_demi_journee && <div className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{d.fin_demi_journee === "MATIN" ? "Matin" : "Après-midi"}</div>}
                  </TableCell>
                  <TableCell className="text-sm">{new Date(d.date_retour).toLocaleDateString("fr-FR")}</TableCell>
                  <TableCell className="text-right">{Number(d.nbr_jours_calendaires || 0).toFixed(1)}</TableCell>
                  <TableCell className="text-right font-medium">{Number(d.nbr_jours_decomptes || 0).toFixed(1)}</TableCell>
                  <TableCell><StatutBadge statut={d.statut} /></TableCell>
                  <TableCell className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {new Date(d.created_at).toLocaleDateString("fr-FR")}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Détail"
                        onClick={() => { setSelected(d); setCommentaireGest(""); setOpenDetail(true); }}>
                        <Eye size={13} />
                      </Button>
                      {(d.statut === "BROUILLON" || d.statut === "EN_ATTENTE") && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Modifier" onClick={() => openEdit(d)}>
                          <Edit size={13} />
                        </Button>
                      )}
                      {d.statut === "EN_ATTENTE" && (
                        <>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Approuver"
                            style={{ color: "hsl(142 71% 45%)" }} onClick={() => { setSelected(d); approuver.mutate(d); }}>
                            <Check size={13} />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Refuser"
                            style={{ color: "hsl(0 72% 51%)" }}
                            onClick={() => { setSelected(d); setMotifRefus(""); setOpenRefus(true); }}>
                            <X size={13} />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ─── Dialog Formulaire ─── */}
      <Dialog open={openForm} onOpenChange={setOpenForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editMode ? "Modifier la demande" : "Nouvelle demande de congé"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">

            {/* Collaborateur + Type */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Collaborateur *</Label>
                <Popover open={openCollabPicker} onOpenChange={setOpenCollabPicker}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" aria-expanded={openCollabPicker}
                      className="w-full justify-between font-normal">
                      {form.collaborateur_id ? (() => {
                        const c = collaborateurs.find(x => x.id === form.collaborateur_id);
                        return c ? `${c.nom} ${c.prenom} (${c.matricule})` : "Sélectionner…";
                      })() : "Sélectionner…"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command
                      filter={(value, search) => {
                        const c = collaborateurs.find(x => x.id === value);
                        if (!c) return 0;
                        const text = `${c.nom} ${c.prenom} ${c.matricule}`.toLowerCase();
                        return text.includes(search.toLowerCase()) ? 1 : 0;
                      }}>
                      <CommandInput placeholder="Rechercher un collaborateur…" autoFocus />
                      <CommandList>
                        <CommandEmpty>Aucun collaborateur trouvé.</CommandEmpty>
                        <CommandGroup>
                          {collaborateurs.map((c) => (
                            <CommandItem key={c.id} value={c.id}
                              onSelect={() => {
                                setForm(f => ({ ...f, collaborateur_id: c.id, code_type_conge: "" }));
                                setOpenCollabPicker(false);
                              }}>
                              <Check className={cn("mr-2 h-4 w-4",
                                form.collaborateur_id === c.id ? "opacity-100" : "opacity-0"
                              )} />
                              <span className="font-medium">{c.nom} {c.prenom}</span>
                              <span className="ml-2 text-xs text-muted-foreground">({c.matricule})</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1">
                <Label>Type de congé *</Label>
                <Select value={form.code_type_conge}
                  onValueChange={handleTypeCongeChange}
                  disabled={!form.collaborateur_id}>
                  <SelectTrigger>
                    <SelectValue placeholder={form.collaborateur_id ? "Sélectionner…" : "Choisir un collaborateur d'abord"} />
                  </SelectTrigger>
                  <SelectContent>
                    {typesCongeDisponibles.map((t) => (
                      <SelectItem key={t.code} value={t.code}>{t.libelle}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.code_type_conge && typeJourActif && (
                  <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Calcul : <span className="font-medium">{typeJourLabel(typeJourActif)}</span>
                    {feriesSet.size > 0 && typeJourActif !== "CAL" && (
                      <span> — {feriesSet.size} jour(s) férié(s) pris en compte</span>
                    )}
                  </p>
                )}
              </div>
            </div>

            {/* Solde actuel — masqué pour les autorisations d'absence (RG-CONGE-AUTOABS-01) */}
            {form.collaborateur_id && form.code_type_conge && !isAutoAbsence && (
              <div className="rounded-lg p-3 border grid grid-cols-4 gap-3"
                style={{ background: "hsl(var(--muted)/0.4)", borderColor: "hsl(var(--border))" }}>
                <div className="text-center">
                  <p className="text-xs mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Acquis</p>
                  <p className="text-lg font-bold" style={{ color: "hsl(var(--foreground))" }}>
                    {soldeForm ? Number(soldeForm.solde_acquis).toFixed(1) : "—"}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Pris</p>
                  <p className="text-lg font-bold" style={{ color: "hsl(var(--foreground))" }}>
                    {soldeForm ? Number(soldeForm.solde_pris).toFixed(1) : "—"}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs mb-0.5 flex items-center justify-center gap-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                    <RefreshCw size={10} /> Reliquat
                  </p>
                  <p className="text-lg font-bold" style={{ color: soldeForm && soldeForm.reliquat_reporte > 0 ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}>
                    {soldeForm ? Number(soldeForm.reliquat_reporte).toFixed(1) : "—"}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs mb-0.5 flex items-center justify-center gap-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                    <TrendingUp size={10} /> Restant
                  </p>
                  {soldeForm ? (
                    <p className="text-lg font-bold" style={{
                      color: soldeForm.solde_restant < 0 ? "hsl(0 72% 51%)"
                        : soldeForm.solde_restant < 3 ? "hsl(38 92% 50%)"
                        : "hsl(142 71% 45%)"
                    }}>
                      {Number(soldeForm.solde_restant).toFixed(1)}
                    </p>
                  ) : (
                    <p className="text-lg font-bold" style={{ color: "hsl(var(--muted-foreground))" }}>—</p>
                  )}
                </div>
                {!soldeForm && (
                  <p className="col-span-4 text-xs text-center" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Aucun solde enregistré pour cet exercice {exercice}
                  </p>
                )}
              </div>
            )}

            {/* Badge informatif pour autorisation d'absence */}
            {form.collaborateur_id && form.code_type_conge && isAutoAbsence && (
              <div className="rounded-lg p-3 flex items-center gap-3 border"
                style={{ background: "hsl(142 60% 45% / 0.06)", borderColor: "hsl(142 60% 45% / 0.3)" }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: "hsl(142 60% 45% / 0.15)" }}>
                  <Check size={16} style={{ color: "hsl(142 60% 35%)" }} />
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: "hsl(142 60% 30%)" }}>
                    Autorisation d'absence accordée de plein droit
                  </p>
                  <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Ce type de congé ne nécessite pas de solde — {droitAutoAbsence}j seront accordés automatiquement selon les droits paramétrés.
                  </p>
                </div>
              </div>
            )}

            {/* Dates – ligne 1 : début */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label>Date de début *</Label>
                <Input type="date" value={form.date_debut}
                  onChange={e => handleDateDebutAutoAbs(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Demi-journée début</Label>
                <Select
                  value={form.debut_demi_journee || "JOURNEE"}
                  onValueChange={v => updateFormDates({ debut_demi_journee: v === "JOURNEE" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="JOURNEE">Journée entière</SelectItem>
                    <SelectItem value="MATIN">Demi-journée matin</SelectItem>
                    <SelectItem value="APRES_MIDI">Demi-journée après-midi</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div></div>
            </div>

            {/* Dates – ligne 2 : fin + retour
                RG-CONGE-AUTOABS-02 : pour les autorisations d'absence,
                date_fin et date_retour sont calculées automatiquement (lecture seule).
            */}
            {isAutoAbsence ? (
              // ── Mode Autorisation d'Absence : date fin et retour calculées ──
              <div className="rounded-lg border p-3 grid grid-cols-3 gap-4"
                style={{ background: "hsl(142 60% 45% / 0.06)", borderColor: "hsl(142 60% 45% / 0.3)" }}>
                <div className="col-span-3 flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold" style={{ color: "hsl(142 60% 35%)" }}>
                    ✓ Autorisation d'absence — {droitAutoAbsence}j accordés de plein droit
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full"
                    style={{ background: "hsl(142 60% 45% / 0.12)", color: "hsl(142 60% 35%)" }}>
                    RG-CONGE-AUTOABS-02 : dates calculées automatiquement
                  </span>
                </div>
                <div className="space-y-1">
                  <Label>Date de fin absence</Label>
                  <Input type="date" value={form.date_fin_absence} readOnly
                    className="cursor-not-allowed"
                    style={{ background: "hsl(142 60% 45% / 0.08)", borderColor: "hsl(142 60% 45% / 0.3)" }} />
                  <p className="text-[10px]" style={{ color: "hsl(142 60% 35%)" }}>
                    Calculée : début + {droitAutoAbsence}j
                  </p>
                </div>
                <div className="space-y-1">
                  <Label>Date de retour</Label>
                  <Input type="date" value={form.date_retour} readOnly
                    className="cursor-not-allowed"
                    style={{ background: "hsl(142 60% 45% / 0.08)", borderColor: "hsl(142 60% 45% / 0.3)" }} />
                  <p className="text-[10px]" style={{ color: "hsl(142 60% 35%)" }}>
                    Lendemain de la fin
                  </p>
                </div>
                <div className="space-y-1 flex flex-col justify-end">
                  <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Aucune saisie requise — les dates sont déterminées par le paramétrage du type de congé.
                  </span>
                </div>
              </div>
            ) : (
              // ── Mode normal : saisie libre ──
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label>Date de fin absence *</Label>
                  <Input type="date" value={form.date_fin_absence}
                    onChange={e => updateFormDates({ date_fin_absence: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Demi-journée fin</Label>
                  <Select
                    value={form.fin_demi_journee || "JOURNEE"}
                    onValueChange={v => updateFormDates({ fin_demi_journee: v === "JOURNEE" ? "" : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="JOURNEE">Journée entière</SelectItem>
                      <SelectItem value="MATIN">Demi-journée matin</SelectItem>
                      <SelectItem value="APRES_MIDI">Demi-journée après-midi</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Date de retour</Label>
                  <Input type="date" value={form.date_retour} readOnly className="bg-muted cursor-not-allowed" />
                  {form.fin_demi_journee === "MATIN" && (
                    <p className="text-xs" style={{ color: "hsl(var(--primary))" }}>
                      Retour après-midi = même jour
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Récapitulatif jours */}
            {form.date_debut && form.date_fin_absence && (
              <div className="p-3 rounded-lg grid grid-cols-3 gap-4" style={{ background: "hsl(var(--primary)/0.08)" }}>
                <div>
                  <span className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Jours calendaires</span>
                  <div className="text-2xl font-bold" style={{ color: "hsl(var(--primary))" }}>{Number(form.nbr_jours_calendaires).toFixed(1)}</div>
                </div>
                <div>
                  <span className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Jours décomptés ({typeJourLabel(typeJourActif)})</span>
                  <div className="text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>{Number(form.nbr_jours_decomptes).toFixed(1)}</div>
                </div>
                {soldeForm && (
                  <div>
                    <span className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Solde après demande</span>
                    <div className="text-2xl font-bold" style={{
                      color: (soldeForm.solde_restant - form.nbr_jours_decomptes) < 0
                        ? "hsl(0 72% 51%)" : "hsl(142 71% 45%)"
                    }}>
                      {(soldeForm.solde_restant - form.nbr_jours_decomptes).toFixed(1)}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Switch checked={form.est_report_reliquat}
                onCheckedChange={v => setForm(f => ({ ...f, est_report_reliquat: v }))} />
              <Label>Consommation sur reliquat reporté</Label>
            </div>

            {/* RG-CONGE-RELIQUAT-INTERDIT-01 (Adil DAIA): Alerte dépassement solde */}
            {(() => {
              if (!typeCongeActif?.interdit_reliquat) return null;
              const disponible = Number(soldeDisponibleControle ?? 0);
              const depassement = form.nbr_jours_decomptes > disponible;
              if (!depassement) return null;
              return (
                <div className="px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2"
                  style={{ background: "hsl(0 72% 51% / 0.1)", border: "1px solid hsl(0 72% 51% / 0.3)", color: "hsl(0 72% 51%)" }}>
                  <X size={14} /> Solde insuffisant : la durée demandée ({form.nbr_jours_decomptes.toFixed(1)}j) dépasse le solde disponible ({disponible.toFixed(1)}j), calculé après déduction des demandes déjà en attente.
                </div>
              );
            })()}

            <div className="space-y-1">
              <Label>Commentaire collaborateur</Label>
              <Textarea rows={2} value={form.commentaire_collaborateur}
                onChange={e => setForm(f => ({ ...f, commentaire_collaborateur: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenForm(false)}>Annuler</Button>
            <Button
              onClick={() => saveDemande.mutate()}
              disabled={saveDemande.isPending || !form.collaborateur_id || !form.code_type_conge || !form.date_debut || !form.date_fin_absence
                || !!(typeCongeActif?.interdit_reliquat && form.nbr_jours_decomptes > Number(soldeDisponibleControle ?? 0))
              }>
              <Send size={14} className="mr-1" /> {saveDemande.isPending ? "Envoi…" : "Soumettre la demande"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Dialog Détail ─── */}
      <Dialog open={openDetail} onOpenChange={setOpenDetail}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Détail de la demande</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Collaborateur</span>
                  <p>{selected.collaborateurs?.nom} {selected.collaborateurs?.prenom}</p></div>
                <div><span className="font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Type</span>
                  <p>{getTypeLibelle(selected.code_type_conge)}</p></div>
                <div><span className="font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Début</span>
                  <p>{new Date(selected.date_debut).toLocaleDateString("fr-FR")}
                    {selected.debut_demi_journee && <span className="ml-1 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>({selected.debut_demi_journee === "MATIN" ? "Matin" : "Après-midi"})</span>}
                  </p></div>
                <div><span className="font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Fin absence</span>
                  <p>{new Date(selected.date_fin_absence).toLocaleDateString("fr-FR")}
                    {selected.fin_demi_journee && <span className="ml-1 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>({selected.fin_demi_journee === "MATIN" ? "Matin" : "Après-midi"})</span>}
                  </p></div>
                <div><span className="font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Date de retour</span>
                  <p className="font-semibold">{new Date(selected.date_retour).toLocaleDateString("fr-FR")}</p></div>
                <div>
                  <span className="font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Jours décomptés</span>
                  <p className="font-bold text-lg">{Number(selected.nbr_jours_decomptes || 0).toFixed(1)}</p>
                </div>
                <div><span className="font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Jours calendaires</span>
                  <p>{Number(selected.nbr_jours_calendaires || 0).toFixed(1)}</p></div>
                <div><span className="font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Statut</span>
                  <p><StatutBadge statut={selected.statut} /></p></div>
              </div>
              {selected.commentaire_collaborateur && (
                <div className="p-3 rounded" style={{ background: "hsl(var(--muted))" }}>
                  <p className="text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Commentaire collaborateur</p>
                  <p className="text-sm">{selected.commentaire_collaborateur}</p>
                </div>
              )}
              {selected.motif_refus && (
                <div className="p-3 rounded border" style={{ borderColor: "hsl(0 72% 51%)", background: "hsl(0 72% 51%/0.05)" }}>
                  <p className="text-xs font-medium mb-1" style={{ color: "hsl(0 72% 51%)" }}>Motif de refus</p>
                  <p className="text-sm">{selected.motif_refus}</p>
                </div>
              )}
              {selected.statut === "EN_ATTENTE" && (
                <div className="space-y-1">
                  <Label>Commentaire gestionnaire</Label>
                  <Textarea rows={2} value={commentaireGest} onChange={e => setCommentaireGest(e.target.value)} />
                </div>
              )}
            </div>
          )}
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            {/* RG-CONGE-REPRISE-01 (Adil DAIA): Enregistrement de la reprise effective */}
            {selected?.statut === "APPROUVEE" && (() => {
              const tc = typesConge.find(t => t.code === selected.code_type_conge);
              return tc?.reprise_obligatoire && !(selected as any).date_reprise_effective ? (
                <div className="flex items-center gap-2 w-full p-2 rounded-lg" style={{ background: "hsl(45 100% 50% / 0.08)", border: "1px solid hsl(45 100% 50% / 0.2)" }}>
                  <Calendar size={14} style={{ color: "hsl(45 100% 35%)" }} />
                  <Input type="date" className="h-8 w-36" value={dateRepriseInput}
                    onChange={e => setDateRepriseInput(e.target.value)} />
                  <Button size="sm" variant="outline" disabled={!dateRepriseInput || enregistrerReprise.isPending}
                    onClick={() => enregistrerReprise.mutate({ demandeId: selected.id, dateReprise: dateRepriseInput })}>
                    <Check size={12} className="mr-1" /> Reprise
                  </Button>
                </div>
              ) : (selected as any).date_reprise_effective ? (
                <span className="text-xs px-2 py-1 rounded-full" style={{ background: "hsl(142 60% 50% / 0.1)", color: "hsl(142 60% 35%)" }}>
                  ✓ Reprise le {new Date((selected as any).date_reprise_effective).toLocaleDateString("fr-FR")}
                </span>
              ) : null;
            })()}

            {/* RG-CONGE-RECOND-01 (Adil DAIA): Bouton de reconduction */}
            {selected?.statut === "APPROUVEE" && (() => {
              const tc = typesConge.find(t => t.code === selected.code_type_conge);
              if (!tc?.reconduction_autorisee) return null;
              const maxAtteint = tc.reconduction_max_nombre != null && (selected as any).reconduction_numero >= tc.reconduction_max_nombre;
              return (
                <Button variant="outline" disabled={maxAtteint || reconduire.isPending}
                  onClick={() => openRecondDialog(selected)}
                  title={maxAtteint ? `Max ${tc.reconduction_max_nombre} reconductions atteint` : `Reconduire (max ${tc.reconduction_duree_jours || 30} jours)`}>
                  <RotateCcw size={14} className="mr-1" /> Reconduire
                  {(selected as any).reconduction_numero > 0 && <span className="ml-1 text-xs">({(selected as any).reconduction_numero}/{tc.reconduction_max_nombre ?? "∞"})</span>}
                </Button>
              );
            })()}

            {selected?.statut === "EN_ATTENTE" && (
              <>
                <Button variant="outline" style={{ borderColor: "hsl(0 72% 51%)", color: "hsl(0 72% 51%)" }}
                  onClick={() => setOpenRefus(true)}>
                  <X size={14} /> Refuser
                </Button>
                <Button style={{ background: "hsl(142 71% 45%)", color: "white" }}
                  onClick={() => approuver.mutate(selected!)} disabled={approuver.isPending}>
                  <Check size={14} /> Approuver
                </Button>
              </>
            )}
            {(selected?.statut === "APPROUVEE" || selected?.statut === "EN_ATTENTE") && (
              <Button variant="outline" onClick={() => annuler.mutate(selected!)} disabled={annuler.isPending}>
                <X size={14} /> Annuler le congé
              </Button>
            )}
            <Button variant="ghost" onClick={() => setOpenDetail(false)}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Dialog Refus ─── */}
      <Dialog open={openRefus} onOpenChange={setOpenRefus}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Motif de refus</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Motif *</Label>
            <Textarea rows={3} placeholder="Indiquer le motif du refus…"
              value={motifRefus} onChange={e => setMotifRefus(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenRefus(false)}>Annuler</Button>
            <Button variant="destructive" onClick={() => selected && refuser.mutate(selected)}
              disabled={!motifRefus.trim() || refuser.isPending}>
              Confirmer le refus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de saisie du nombre de jours pour la reconduction */}
      <Dialog open={recondDialog.open} onOpenChange={(o) => !o && setRecondDialog(p => ({ ...p, open: false }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reconduction du congé</DialogTitle>
            <DialogDescription>
              Saisissez le nombre de jours souhaité (maximum {recondDialog.max} jours).
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="recond-jours">Nombre de jours</Label>
            <Input id="recond-jours" type="number" min={1} max={recondDialog.max}
              value={recondDialog.jours}
              onChange={e => setRecondDialog(p => ({ ...p, jours: Math.min(Math.max(1, Number(e.target.value)), p.max) }))}
              className="mt-1" />
            <p className="text-xs text-muted-foreground mt-1">Entre 1 et {recondDialog.max} jours</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRecondDialog(p => ({ ...p, open: false }))}>Annuler</Button>
            <Button disabled={recondDialog.jours < 1 || reconduire.isPending}
              onClick={() => recondDialog.demande && reconduire.mutate({ demande: recondDialog.demande, jours: recondDialog.jours })}>
              Confirmer la reconduction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
