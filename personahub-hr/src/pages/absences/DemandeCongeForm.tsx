import React, { useState, useMemo, useEffect } from "react";
import { db, api } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, RefreshCw, TrendingUp, X, Send } from "lucide-react";
import { calcJoursAvecType, calcDateFinAutoAbsence, calcDateRetour, typeJourLabel } from "./congeCalculs";

/**
 * DemandeCongeForm — formulaire de saisie/modification d'une demande de congé.
 * Logique extraite de SaisieCongesPage pour être PARTAGÉE (espace collaborateur + écran de gestion).
 *
 * Props :
 *  - collaborateurId   : si fourni → collaborateur fixe (espace collaborateur). Sinon → picker (RH/manager).
 *  - exercice          : année de référence des soldes.
 *  - editDemande       : demande à modifier (mode édition) ; sinon création.
 *  - collaborateurs    : liste pour le picker (uniquement si pas de collaborateurId fixe).
 *  - onSuccess         : callback après enregistrement réussi.
 *  - onCancel          : callback bouton Annuler.
 */
export interface DemandeLike {
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
  commentaire_collaborateur: string | null;
  est_report_reliquat: boolean;
}

interface Collaborateur { id: string; matricule: string; nom: string; prenom: string; code_genre: string; }
interface TypeConge {
  code: string; libelle: string; justificatif_obligatoire: boolean;
  population_criteres: Record<string, string[]> | null;
  code_type_jour: string | null;
  reconduction_autorisee: boolean; reconduction_max_nombre: number | null; reconduction_duree_jours: number | null;
  reprise_obligatoire: boolean; anciennete_min_mois: number | null; interdit_reliquat: boolean;
  est_autorisation_absence: boolean;
  droit_legal_jours: number | null; droit_convention_jours: number | null; droit_particulier_jours: number | null;
  // Règles de gestion (cf. ref_type_conge)
  solde_negatif_autorise: boolean | null;
  duree_max: number | null;
  preavis_jours: number | null;
  controle_chevauchement: string | null;      // 'STRICT' = bloquant
  fractionnement_autorise: boolean | null;
  fractionnement_min_jours: number | null;
}
interface Solde { solde_acquis: number; solde_pris: number; solde_en_attente: number; solde_restant: number; reliquat_reporte: number; }

const EMPTY_FORM = {
  collaborateur_id: "", code_type_conge: "",
  date_debut: "", date_fin_absence: "", date_retour: "",
  debut_demi_journee: "", fin_demi_journee: "",
  nbr_jours_calendaires: 0, nbr_jours_decomptes: 0,
  commentaire_collaborateur: "", est_report_reliquat: false,
};

interface Props {
  collaborateurId?: string;
  exercice: number;
  editDemande?: DemandeLike | null;
  collaborateurs?: Collaborateur[];
  onSuccess?: () => void;
  onCancel?: () => void;
}

export default function DemandeCongeForm({ collaborateurId, exercice, editDemande, collaborateurs = [], onSuccess, onCancel }: Props) {
  const qc = useQueryClient();
  const editMode = !!editDemande;
  const collabFixed = !!collaborateurId;
  const [openCollabPicker, setOpenCollabPicker] = useState(false);

  const [form, setForm] = useState(() => {
    if (editDemande) {
      return {
        collaborateur_id: editDemande.collaborateur_id, code_type_conge: editDemande.code_type_conge,
        date_debut: editDemande.date_debut, date_fin_absence: editDemande.date_fin_absence, date_retour: editDemande.date_retour,
        debut_demi_journee: editDemande.debut_demi_journee || "", fin_demi_journee: editDemande.fin_demi_journee || "",
        nbr_jours_calendaires: editDemande.nbr_jours_calendaires ?? 0, nbr_jours_decomptes: editDemande.nbr_jours_decomptes ?? 0,
        commentaire_collaborateur: editDemande.commentaire_collaborateur || "", est_report_reliquat: editDemande.est_report_reliquat,
      };
    }
    return { ...EMPTY_FORM, collaborateur_id: collaborateurId || "" };
  });

  // Garder collaborateur_id synchro si le prop change
  useEffect(() => {
    if (collaborateurId && form.collaborateur_id !== collaborateurId && !editMode) {
      setForm(f => ({ ...f, collaborateur_id: collaborateurId }));
    }
  }, [collaborateurId]); // eslint-disable-line

  // ── Types de congé ──
  const { data: typesConge = [] } = useQuery<TypeConge[]>({
    queryKey: ["ref-type-conge-avec-criteres-v4"],
    queryFn: async () => {
      const rows = await db.list<any>("ref_type_conge", { actif: true, order: "ordre" });
      return rows.map(r => {
        const raw = r.population_criteres as any;
        const population_criteres = raw ? {
          genres: Array.isArray(raw.genres) ? raw.genres : [],
          categories_pro: Array.isArray(raw.categories_pro) ? raw.categories_pro : [],
          types_contrat: Array.isArray(raw.types_contrat) ? raw.types_contrat : [],
          anciennete_min_mois: raw.anciennete_min_mois != null ? Number(raw.anciennete_min_mois) : null,
          anciennete_max_mois: raw.anciennete_max_mois != null ? Number(raw.anciennete_max_mois) : null,
        } : null;
        return { ...r, id: r.code, population_criteres };
      }) as TypeConge[];
    },
  });

  // ── Jours fériés ──
  const { data: feriesSet = new Set<string>() } = useQuery<Set<string>>({
    queryKey: ["jours-feries-calcul-v2", exercice],
    queryFn: async () => {
      const data = await db.list<{ date_debut: string; nombre_jours: number | null }>("ref_jours_feries", {
        select: "date_debut,nombre_jours", "date_debut": `gte.${exercice}-01-01`,
      });
      const s = new Set<string>();
      data.forEach((r) => {
        const nb = r.nombre_jours ?? 1;
        const d = new Date(r.date_debut + "T00:00:00");
        for (let i = 0; i < nb; i++) { const cur = new Date(d); cur.setDate(cur.getDate() + i); s.add(cur.toISOString().split("T")[0]); }
      });
      return s;
    },
  });

  // ── Solde du type sélectionné ──
  const { data: soldeForm } = useQuery<Solde | null>({
    queryKey: ["cong-solde-form", form.collaborateur_id, form.code_type_conge, exercice],
    enabled: !!form.collaborateur_id && !!form.code_type_conge,
    queryFn: async () => {
      const row = await db.findOne<any>("cong_solde", {
        select: "solde_acquis,solde_pris,solde_en_attente,solde_restant,reliquat_reporte",
        collaborateur_id: form.collaborateur_id, code_type_conge: form.code_type_conge, exercice, archive: false,
      });
      if (!row) return null;
      return {
        solde_acquis: Number(row.solde_acquis ?? 0), solde_pris: Number(row.solde_pris ?? 0),
        solde_en_attente: Number(row.solde_en_attente ?? 0), solde_restant: Number(row.solde_restant ?? 0),
        reliquat_reporte: Number(row.reliquat_reporte ?? 0),
      } as Solde;
    },
  });

  // ── Date début contrat actif ──
  const { data: dateDebutContrat = null } = useQuery<string | null>({
    queryKey: ["contrat-actif-date-debut", form.collaborateur_id],
    enabled: !!form.collaborateur_id,
    queryFn: async () => {
      const row = await db.findOne<{ date_debut: string }>("collaborateur_contrats", {
        select: "date_debut", collaborateur_id: form.collaborateur_id, code_statut_contrat: "ACTIF",
        archive: false, "date_sortie__isnull": true, order: "-date_debut",
      });
      return row?.date_debut ?? null;
    },
  });

  // ── Derived ──
  const erreurDateContrat = useMemo(() => {
    if (!form.date_debut || !dateDebutContrat) return null;
    const dc = new Date(form.date_debut + "T00:00:00"), dk = new Date(dateDebutContrat + "T00:00:00");
    if (dc <= dk) return `La date de début du congé (${dc.toLocaleDateString("fr-FR")}) doit être strictement postérieure à la date de début du contrat (${dk.toLocaleDateString("fr-FR")}).`;
    return null;
  }, [form.date_debut, dateDebutContrat]);

  const typeCongeActif = useMemo(() => form.code_type_conge ? (typesConge.find(t => t.code === form.code_type_conge) || null) : null, [form.code_type_conge, typesConge]);

  const erreurAnciennete = useMemo(() => {
    const min = typeCongeActif?.anciennete_min_mois ?? null;
    if (min == null || min <= 0 || !dateDebutContrat || !form.date_debut) return null;
    const [cy, cm, cd] = form.date_debut.split("-").map(Number);
    const [ky, km, kd] = dateDebutContrat.split("-").map(Number);
    const mois = (cy - ky) * 12 + (cm - km) - (cd < kd ? 1 : 0);
    if (mois < min) { const manque = min - mois; return `Ancienneté insuffisante. Actuelle : ${mois} mois — minimum requis : ${min} mois (encore ${manque} mois manquant${manque > 1 ? "s" : ""}).`; }
    return null;
  }, [typeCongeActif, dateDebutContrat, form.date_debut]);

  const isAutoAbsence = useMemo(() => !!typeCongeActif?.est_autorisation_absence, [typeCongeActif]);
  const droitAutoAbsence = useMemo(() => !typeCongeActif?.est_autorisation_absence ? 0 : (typeCongeActif.droit_convention_jours ?? typeCongeActif.droit_legal_jours ?? 0), [typeCongeActif]);
  const soldeDisponibleControle = useMemo(() => !typeCongeActif?.interdit_reliquat ? null : Number(soldeForm?.solde_restant ?? 0) - Number(soldeForm?.solde_en_attente ?? 0), [typeCongeActif, soldeForm]);

  // Solde projeté après cette demande (restant − jours décomptés)
  const soldeApresDemande = useMemo(() => {
    if (!soldeForm) return null;
    return Number(soldeForm.solde_restant ?? 0) - Number(form.nbr_jours_decomptes ?? 0);
  }, [soldeForm, form.nbr_jours_decomptes]);

  // ── VALIDATION CENTRALISÉE DES RÈGLES DE GESTION ──
  // Chaque entrée : { regle, message, bloquant }. Les bloquantes désactivent la soumission.
  const validations = useMemo(() => {
    const v: { regle: string; message: string; bloquant: boolean }[] = [];
    const tc = typeCongeActif;
    if (!tc || !form.date_debut || !form.date_fin_absence) return v;

    // 1) Date de fin ≥ date de début
    if (new Date(form.date_fin_absence) < new Date(form.date_debut)) {
      v.push({ regle: "dates", message: "La date de fin doit être postérieure ou égale à la date de début.", bloquant: true });
    }

    // 2) Date début > date début contrat (déjà calculé)
    if (erreurDateContrat) v.push({ regle: "contrat", message: erreurDateContrat, bloquant: true });

    // 3) Ancienneté minimale (déjà calculé)
    if (erreurAnciennete) v.push({ regle: "anciennete", message: erreurAnciennete, bloquant: true });

    // 4) Solde négatif interdit
    if (tc.solde_negatif_autorise === false && soldeApresDemande != null && soldeApresDemande < 0) {
      v.push({ regle: "solde", message: `Solde insuffisant : le solde après demande serait de ${soldeApresDemande.toFixed(1)} j. Ce type de congé n'autorise pas le solde négatif.`, bloquant: true });
    }

    // 5) Durée maximale
    if (tc.duree_max != null && tc.duree_max > 0 && Number(form.nbr_jours_decomptes) > tc.duree_max) {
      v.push({ regle: "duree_max", message: `Durée maximale dépassée : ${Number(form.nbr_jours_decomptes).toFixed(1)} j demandés pour un maximum de ${tc.duree_max} j.`, bloquant: true });
    }

    // 6) Préavis (mesuré depuis aujourd'hui = date de soumission)
    if (tc.preavis_jours != null && tc.preavis_jours > 0) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const mini = new Date(today); mini.setDate(mini.getDate() + tc.preavis_jours);
      if (new Date(form.date_debut + "T00:00:00") < mini) {
        v.push({ regle: "preavis", message: `Préavis insuffisant : ce congé requiert un préavis de ${tc.preavis_jours} jour(s). La date de début la plus proche est le ${mini.toLocaleDateString("fr-FR")}.`, bloquant: true });
      }
    }

    // 7) Fractionnement : si non autorisé, ou en deçà du minimum
    if (tc.fractionnement_autorise === false && tc.fractionnement_min_jours != null && tc.fractionnement_min_jours > 0
        && Number(form.nbr_jours_decomptes) < tc.fractionnement_min_jours) {
      v.push({ regle: "fractionnement", message: `Fractionnement non autorisé en deçà de ${tc.fractionnement_min_jours} j (durée demandée : ${Number(form.nbr_jours_decomptes).toFixed(1)} j).`, bloquant: true });
    }

    // 8) Justificatif obligatoire — AVERTISSEMENT (upload pas encore disponible : chantier 2)
    if (tc.justificatif_obligatoire) {
      v.push({ regle: "justificatif", message: "Ce type de congé requiert une pièce justificative. Pensez à la transmettre au service RH (l'upload sera bientôt disponible dans le formulaire).", bloquant: false });
    }

    return v;
  }, [typeCongeActif, form.date_debut, form.date_fin_absence, form.nbr_jours_decomptes, erreurDateContrat, erreurAnciennete, soldeApresDemande]);

  const violationsBloquantes = useMemo(() => validations.filter(x => x.bloquant), [validations]);

  const { data: chevauchement = null } = useQuery<{ libelle: string; date_debut: string; date_fin_absence: string; statut: string } | null>({
    queryKey: ["chevauchement-conge", form.collaborateur_id, form.date_debut, form.date_fin_absence, editDemande?.id],
    enabled: !!form.collaborateur_id && !!form.date_debut && !!form.date_fin_absence
      && (typeCongeActif?.controle_chevauchement ?? "STRICT") === "STRICT",
    queryFn: async () => {
      const f: Record<string, unknown> = {
        select: "id,date_debut,date_fin_absence,code_type_conge,statut",
        collaborateur_id: form.collaborateur_id,
        "date_debut": `lte.${form.date_fin_absence}`, "date_fin_absence": `gte.${form.date_debut}`,
      };
      if (editMode && editDemande) f["id"] = `neq.${editDemande.id}`;
      const rows = await db.list<any>("cong_demandes", f);
      const STATUTS_BLOQUANTS = ["en_attente", "approuvee", "brouillon", "modifiee"];
      const ov = (rows || []).find(r => STATUTS_BLOQUANTS.includes(String(r.statut ?? "").toLowerCase()));
      if (!ov) return null;
      const ovType = typesConge.find(t => t.code === ov.code_type_conge);
      return { libelle: ovType?.libelle || ov.code_type_conge, date_debut: ov.date_debut, date_fin_absence: ov.date_fin_absence, statut: ov.statut };
    },
  });

  // Toutes les violations = règles statiques + chevauchement live
  const toutesViolations = useMemo(() => {
    const list = [...validations];
    if (chevauchement) {
      list.push({
        regle: "chevauchement",
        message: `Chevauchement : une demande "${chevauchement.libelle}" du ${new Date(chevauchement.date_debut).toLocaleDateString("fr-FR")} au ${new Date(chevauchement.date_fin_absence).toLocaleDateString("fr-FR")} existe déjà (statut : ${chevauchement.statut}).`,
        bloquant: true,
      });
    }
    return list;
  }, [validations, chevauchement]);

  const violationsBloquantesTotal = useMemo(() => toutesViolations.filter(x => x.bloquant), [toutesViolations]);

  const codeGenreCollab = useMemo(() => {
    if (!form.collaborateur_id) return null;
    return collaborateurs.find(c => c.id === form.collaborateur_id)?.code_genre || null;
  }, [form.collaborateur_id, collaborateurs]);

  const typesCongeDisponibles = useMemo(() => {
    if (!codeGenreCollab) return typesConge;
    return typesConge.filter(t => {
      const g = t.population_criteres?.genres;
      if (!g || g.length === 0) return true;
      return g.includes(codeGenreCollab);
    });
  }, [typesConge, codeGenreCollab]);

  const typeJourActif = useMemo(() => typeCongeActif?.code_type_jour || null, [typeCongeActif]);

  // ── Handlers ──
  const updateFormDates = (updates: Partial<typeof form>) => {
    const merged = { ...form, ...updates };
    const { cal, dec } = calcJoursAvecType(merged.date_debut, merged.date_fin_absence, merged.debut_demi_journee, merged.fin_demi_journee, typeJourActif, feriesSet);
    const retour = calcDateRetour(merged.date_fin_absence, merged.fin_demi_journee, typeJourActif, feriesSet);
    setForm(f => ({ ...f, ...updates, nbr_jours_calendaires: cal, nbr_jours_decomptes: dec, date_retour: retour }));
  };
  const handleTypeCongeChange = (code: string) => {
    const tc = typesConge.find(t => t.code === code);
    const newTypeJour = tc?.code_type_jour || null;
    const isAutoAbs = !!tc?.est_autorisation_absence;
    const droit = tc?.droit_convention_jours ?? tc?.droit_legal_jours ?? 0;
    let newDateFin = form.date_fin_absence;
    if (isAutoAbs && droit > 0 && form.date_debut) newDateFin = calcDateFinAutoAbsence(form.date_debut, droit);
    const { cal, dec } = calcJoursAvecType(form.date_debut, newDateFin, form.debut_demi_journee, form.fin_demi_journee, newTypeJour, feriesSet);
    const retour = calcDateRetour(newDateFin, form.fin_demi_journee, newTypeJour, feriesSet);
    setForm(f => ({ ...f, code_type_conge: code, date_fin_absence: newDateFin, nbr_jours_calendaires: cal, nbr_jours_decomptes: dec, date_retour: retour }));
  };
  const handleDateDebutAutoAbs = (dateDebut: string) => {
    if (!isAutoAbsence || droitAutoAbsence <= 0) { updateFormDates({ date_debut: dateDebut }); return; }
    const newDateFin = calcDateFinAutoAbsence(dateDebut, droitAutoAbsence);
    const { cal, dec } = calcJoursAvecType(dateDebut, newDateFin, form.debut_demi_journee, form.fin_demi_journee, typeJourActif, feriesSet);
    const retour = calcDateRetour(newDateFin, form.fin_demi_journee, typeJourActif, feriesSet);
    setForm(f => ({ ...f, date_debut: dateDebut, date_fin_absence: newDateFin, nbr_jours_calendaires: cal, nbr_jours_decomptes: dec, date_retour: retour }));
  };

  // ── Mutation ──
  const saveDemande = useMutation({
    mutationFn: async () => {
      // Garde-fou : aucune règle bloquante ne doit passer (en plus du bouton désactivé)
      if (violationsBloquantes.length > 0) {
        throw new Error(violationsBloquantes.map(x => "• " + x.message).join("\n"));
      }
      if (typeCongeActif?.interdit_reliquat) {
        const disponible = Number(soldeDisponibleControle ?? 0);
        if (form.nbr_jours_decomptes > disponible) throw new Error(`Solde insuffisant : ${form.nbr_jours_decomptes.toFixed(1)}j demandés pour ${disponible.toFixed(1)}j disponibles.`);
      }
      // Chevauchement (controle_chevauchement = 'STRICT' → bloquant)
      // On bloque uniquement contre les demandes EN ATTENTE ou APPROUVÉE.
      // Le filtre statut est appliqué côté JS pour être insensible à la casse
      // (les statuts peuvent être stockés en minuscules : en_attente / approuvee).
      if ((typeCongeActif?.controle_chevauchement ?? "STRICT") === "STRICT") {
        const f: Record<string, unknown> = {
          select: "id,date_debut,date_fin_absence,code_type_conge,statut",
          collaborateur_id: form.collaborateur_id,
          "date_debut": `lte.${form.date_fin_absence}`, "date_fin_absence": `gte.${form.date_debut}`,
        };
        if (editMode && editDemande) f["id"] = `neq.${editDemande.id}`;
        const rows = await db.list<any>("cong_demandes", f);
        const STATUTS_BLOQUANTS = ["en_attente", "approuvee", "brouillon", "modifiee"];
        const overlaps = (rows || []).filter(r =>
          STATUTS_BLOQUANTS.includes(String(r.statut ?? "").toLowerCase())
        );
        if (overlaps.length > 0) {
          const ov = overlaps[0];
          const ovType = typesConge.find(t => t.code === ov.code_type_conge);
          throw new Error(`Chevauchement détecté : une demande "${ovType?.libelle || ov.code_type_conge}" du ${new Date(ov.date_debut).toLocaleDateString("fr-FR")} au ${new Date(ov.date_fin_absence).toLocaleDateString("fr-FR")} existe déjà (statut : ${ov.statut}).`);
        }
      }
      const payload = {
        collaborateur_id: form.collaborateur_id, code_type_conge: form.code_type_conge,
        date_debut: form.date_debut, date_fin_absence: form.date_fin_absence, date_retour: form.date_retour,
        debut_demi_journee: form.debut_demi_journee || null, fin_demi_journee: form.fin_demi_journee || null,
        nbr_jours_calendaires: form.nbr_jours_calendaires, nbr_jours_decomptes: form.nbr_jours_decomptes,
        commentaire_collaborateur: form.commentaire_collaborateur || null, est_report_reliquat: form.est_report_reliquat,
        statut: "en_attente", date_soumission: new Date().toISOString().split("T")[0],
      };
      if (editMode && editDemande) {
        await db.update("cong_demandes", { id: editDemande.id }, { ...payload, statut: "modifiee", demande_originale_id: editDemande.id });
      } else {
        const created = await db.create<{ id: string }>("cong_demandes", payload);
        // Déclenchement générique du workflow (l'affectation process↔traitement est en base).
        // Best-effort : un échec ne bloque pas la création de la demande.
        try {
          if (created?.id) {
            await api.post("/workflow/trigger", { table_source: "cong_demandes", id: created.id, evenement: "SOUMISSION" });
          }
        } catch (e) {
          console.warn("[workflow] déclenchement non effectué:", e);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cong-demandes"] });
      qc.invalidateQueries({ queryKey: ["cong-soldes"] });
      qc.invalidateQueries({ queryKey: ["mes-soldes"] });
      toast({ title: editMode ? "Demande modifiée" : "Demande soumise avec succès" });
      onSuccess?.();
    },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const submitDisabled = saveDemande.isPending || !form.collaborateur_id || !form.code_type_conge || !form.date_debut || !form.date_fin_absence
    || !!(typeCongeActif?.interdit_reliquat && form.nbr_jours_decomptes > Number(soldeDisponibleControle ?? 0))
    || violationsBloquantesTotal.length > 0;

  // Tentative de soumission : si des règles bloquent, afficher un popup listant chaque violation
  const tenterSoumission = () => {
    if (violationsBloquantesTotal.length > 0) {
      toast({
        title: violationsBloquantesTotal.length > 1 ? `${violationsBloquantesTotal.length} règles bloquent la demande` : "Règle non respectée",
        description: violationsBloquantesTotal.map(x => "• " + x.message).join("\n"),
        variant: "destructive",
      });
      return;
    }
    // Avertissements non bloquants (ex. justificatif) : informer sans empêcher
    const avertissements = toutesViolations.filter(x => !x.bloquant);
    if (avertissements.length > 0) {
      toast({ title: "À noter", description: avertissements.map(x => "• " + x.message).join("\n") });
    }
    saveDemande.mutate();
  };

  return (
    <div className="grid gap-4 py-2">
      {/* Collaborateur (picker) + Type */}
      <div className={collabFixed ? "" : "grid grid-cols-2 gap-4"}>
        {!collabFixed && (
          <div className="space-y-1">
            <Label>Collaborateur *</Label>
            <Popover open={openCollabPicker} onOpenChange={setOpenCollabPicker}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={openCollabPicker} className="w-full justify-between font-normal">
                  {form.collaborateur_id ? (() => { const c = collaborateurs.find(x => x.id === form.collaborateur_id); return c ? `${c.nom} ${c.prenom} (${c.matricule})` : "Sélectionner…"; })() : "Sélectionner…"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command filter={(value, search) => { const c = collaborateurs.find(x => x.id === value); if (!c) return 0; return `${c.nom} ${c.prenom} ${c.matricule}`.toLowerCase().includes(search.toLowerCase()) ? 1 : 0; }}>
                  <CommandInput placeholder="Rechercher un collaborateur…" autoFocus />
                  <CommandList>
                    <CommandEmpty>Aucun collaborateur trouvé.</CommandEmpty>
                    <CommandGroup>
                      {collaborateurs.map((c) => (
                        <CommandItem key={c.id} value={c.id} onSelect={() => { setForm(f => ({ ...f, collaborateur_id: c.id, code_type_conge: "" })); setOpenCollabPicker(false); }}>
                          <Check className={cn("mr-2 h-4 w-4", form.collaborateur_id === c.id ? "opacity-100" : "opacity-0")} />
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
        )}
        <div className="space-y-1">
          <Label>Type de congé *</Label>
          <Select value={form.code_type_conge} onValueChange={handleTypeCongeChange} disabled={!form.collaborateur_id}>
            <SelectTrigger><SelectValue placeholder={form.collaborateur_id ? "Sélectionner…" : "Choisir un collaborateur d'abord"} /></SelectTrigger>
            <SelectContent>
              {typesCongeDisponibles.map((t) => (<SelectItem key={t.code} value={t.code}>{t.libelle}</SelectItem>))}
            </SelectContent>
          </Select>
          {form.code_type_conge && typeJourActif && (
            <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
              Calcul : <span className="font-medium">{typeJourLabel(typeJourActif)}</span>
              {feriesSet.size > 0 && typeJourActif !== "CAL" && (<span> — {feriesSet.size} jour(s) férié(s) pris en compte</span>)}
            </p>
          )}
        </div>
      </div>

      {/* Solde — masqué pour autorisation d'absence */}
      {form.collaborateur_id && form.code_type_conge && !isAutoAbsence && (
        <div className="rounded-lg p-3 border grid grid-cols-4 gap-3" style={{ background: "hsl(var(--muted)/0.4)", borderColor: "hsl(var(--border))" }}>
          <div className="text-center"><p className="text-xs mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Acquis</p><p className="text-lg font-bold" style={{ color: "hsl(var(--foreground))" }}>{soldeForm ? Number(soldeForm.solde_acquis).toFixed(1) : "—"}</p></div>
          <div className="text-center"><p className="text-xs mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Pris</p><p className="text-lg font-bold" style={{ color: "hsl(var(--foreground))" }}>{soldeForm ? Number(soldeForm.solde_pris).toFixed(1) : "—"}</p></div>
          <div className="text-center"><p className="text-xs mb-0.5 flex items-center justify-center gap-1" style={{ color: "hsl(var(--muted-foreground))" }}><RefreshCw size={10} /> Reliquat</p><p className="text-lg font-bold" style={{ color: soldeForm && soldeForm.reliquat_reporte > 0 ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}>{soldeForm ? Number(soldeForm.reliquat_reporte).toFixed(1) : "—"}</p></div>
          <div className="text-center"><p className="text-xs mb-0.5 flex items-center justify-center gap-1" style={{ color: "hsl(var(--muted-foreground))" }}><TrendingUp size={10} /> Restant</p>{soldeForm ? (<p className="text-lg font-bold" style={{ color: soldeForm.solde_restant < 0 ? "hsl(0 72% 51%)" : soldeForm.solde_restant < 3 ? "hsl(38 92% 50%)" : "hsl(142 71% 45%)" }}>{Number(soldeForm.solde_restant).toFixed(1)}</p>) : (<p className="text-lg font-bold" style={{ color: "hsl(var(--muted-foreground))" }}>—</p>)}</div>
          {!soldeForm && (<p className="col-span-4 text-xs text-center" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun solde enregistré pour cet exercice {exercice}</p>)}
        </div>
      )}

      {/* Badge autorisation d'absence */}
      {form.collaborateur_id && form.code_type_conge && isAutoAbsence && (
        <div className="rounded-lg p-3 flex items-center gap-3 border" style={{ background: "hsl(142 60% 45% / 0.06)", borderColor: "hsl(142 60% 45% / 0.3)" }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "hsl(142 60% 45% / 0.15)" }}><Check size={16} style={{ color: "hsl(142 60% 35%)" }} /></div>
          <div><p className="text-sm font-semibold" style={{ color: "hsl(142 60% 30%)" }}>Autorisation d'absence accordée de plein droit</p><p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Ce type de congé ne nécessite pas de solde — {droitAutoAbsence}j seront accordés automatiquement selon les droits paramétrés.</p></div>
        </div>
      )}

      {/* Date début */}
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1">
          <Label>Date de début *</Label>
          <Input type="date" value={form.date_debut} min={(() => {
            const today = new Date(); today.setHours(0,0,0,0);
            const pre = typeCongeActif?.preavis_jours ?? 0;
            if (pre > 0) today.setDate(today.getDate() + pre);
            return today.toISOString().split("T")[0];
          })()} onChange={e => handleDateDebutAutoAbs(e.target.value)} style={erreurDateContrat ? { borderColor: "hsl(var(--destructive))" } : {}} />
          {erreurDateContrat && (<div className="flex items-start gap-1.5 mt-1"><span style={{ color: "hsl(0 72% 51%)", flexShrink: 0, fontSize: "calc(13px * var(--font-scale))" }}>⚠</span><p className="text-xs leading-tight" style={{ color: "hsl(0 72% 45%)" }}>{erreurDateContrat}</p></div>)}
          {erreurAnciennete && !erreurDateContrat && (<div className="flex items-start gap-1.5 mt-1"><span style={{ color: "hsl(0 72% 51%)", flexShrink: 0, fontSize: "calc(13px * var(--font-scale))" }}>⚠</span><p className="text-xs leading-tight" style={{ color: "hsl(0 72% 45%)" }}>{erreurAnciennete}</p></div>)}
        </div>
        <div className="space-y-1">
          <Label>Demi-journée début</Label>
          <Select value={form.debut_demi_journee || "JOURNEE"} onValueChange={v => updateFormDates({ debut_demi_journee: v === "JOURNEE" ? "" : v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="JOURNEE">Journée entière</SelectItem><SelectItem value="MATIN">Demi-journée matin</SelectItem><SelectItem value="APRES_MIDI">Demi-journée après-midi</SelectItem></SelectContent>
          </Select>
        </div>
        <div></div>
      </div>

      {/* Fin + retour */}
      {isAutoAbsence ? (
        <div className="rounded-lg border p-3 grid grid-cols-3 gap-4" style={{ background: "hsl(142 60% 45% / 0.06)", borderColor: "hsl(142 60% 45% / 0.3)" }}>
          <div className="col-span-3 flex items-center gap-2 mb-1"><span className="text-xs font-semibold" style={{ color: "hsl(142 60% 35%)" }}>✓ Autorisation d'absence — {droitAutoAbsence}j accordés de plein droit</span><span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "hsl(142 60% 45% / 0.12)", color: "hsl(142 60% 35%)" }}>dates calculées automatiquement</span></div>
          <div className="space-y-1"><Label>Date de fin absence</Label><Input type="date" value={form.date_fin_absence} readOnly className="cursor-not-allowed" style={{ background: "hsl(142 60% 45% / 0.08)", borderColor: "hsl(142 60% 45% / 0.3)" }} /><p className="text-[10px]" style={{ color: "hsl(142 60% 35%)" }}>Calculée : début + {droitAutoAbsence}j</p></div>
          <div className="space-y-1"><Label>Date de retour</Label><Input type="date" value={form.date_retour} readOnly className="cursor-not-allowed" style={{ background: "hsl(142 60% 45% / 0.08)", borderColor: "hsl(142 60% 45% / 0.3)" }} /><p className="text-[10px]" style={{ color: "hsl(142 60% 35%)" }}>Lendemain de la fin</p></div>
          <div className="space-y-1 flex flex-col justify-end"><span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune saisie requise — dates déterminées par le paramétrage.</span></div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1"><Label>Date de fin absence *</Label><Input type="date" value={form.date_fin_absence} min={form.date_debut || undefined} onChange={e => updateFormDates({ date_fin_absence: e.target.value })} /></div>
          <div className="space-y-1"><Label>Demi-journée fin</Label><Select value={form.fin_demi_journee || "JOURNEE"} onValueChange={v => updateFormDates({ fin_demi_journee: v === "JOURNEE" ? "" : v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="JOURNEE">Journée entière</SelectItem><SelectItem value="MATIN">Demi-journée matin</SelectItem><SelectItem value="APRES_MIDI">Demi-journée après-midi</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><Label>Date de retour</Label><Input type="date" value={form.date_retour} readOnly className="bg-muted cursor-not-allowed" />{form.fin_demi_journee === "MATIN" && (<p className="text-xs" style={{ color: "hsl(var(--primary))" }}>Retour après-midi = même jour</p>)}</div>
        </div>
      )}

      {/* Récap jours */}
      {form.date_debut && form.date_fin_absence && (
        <div className="p-3 rounded-lg grid grid-cols-3 gap-4" style={{ background: "hsl(var(--primary)/0.08)" }}>
          <div><span className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Jours calendaires</span><div className="text-2xl font-bold" style={{ color: "hsl(var(--primary))" }}>{Number(form.nbr_jours_calendaires).toFixed(1)}</div></div>
          <div><span className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Jours décomptés ({typeJourLabel(typeJourActif)})</span><div className="text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>{Number(form.nbr_jours_decomptes).toFixed(1)}</div></div>
          {soldeForm && (<div><span className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Solde après demande</span><div className="text-2xl font-bold" style={{ color: (soldeForm.solde_restant - form.nbr_jours_decomptes) < 0 ? "hsl(0 72% 51%)" : "hsl(142 71% 45%)" }}>{(soldeForm.solde_restant - form.nbr_jours_decomptes).toFixed(1)}</div></div>)}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Switch checked={form.est_report_reliquat} onCheckedChange={v => setForm(f => ({ ...f, est_report_reliquat: v }))} />
        <Label>Consommation sur reliquat reporté</Label>
      </div>

      {(() => {
        if (!typeCongeActif?.interdit_reliquat) return null;
        const disponible = Number(soldeDisponibleControle ?? 0);
        if (form.nbr_jours_decomptes <= disponible) return null;
        return (<div className="px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2" style={{ background: "hsl(0 72% 51% / 0.1)", border: "1px solid hsl(0 72% 51% / 0.3)", color: "hsl(0 72% 51%)" }}><X size={14} /> Solde insuffisant : la durée demandée ({form.nbr_jours_decomptes.toFixed(1)}j) dépasse le solde disponible ({disponible.toFixed(1)}j), calculé après déduction des demandes déjà en attente.</div>);
      })()}

      {toutesViolations.length > 0 && (
        <div className="space-y-1.5">
          {toutesViolations.map((x, i) => (
            <div key={i} className="px-3 py-2 rounded-lg text-xs font-medium flex items-start gap-2"
              style={x.bloquant
                ? { background: "hsl(var(--destructive) / 0.1)", border: "1px solid hsl(var(--destructive) / 0.3)", color: "hsl(var(--destructive))" }
                : { background: "hsl(var(--warning) / 0.1)", border: "1px solid hsl(var(--warning) / 0.3)", color: "hsl(var(--warning))" }}>
              <X size={14} className="flex-shrink-0 mt-0.5" /> <span>{x.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1">
        <Label>Commentaire collaborateur</Label>
        <Textarea rows={2} value={form.commentaire_collaborateur} onChange={e => setForm(f => ({ ...f, commentaire_collaborateur: e.target.value }))} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && <Button variant="outline" onClick={onCancel}>Annuler</Button>}
        <Button onClick={tenterSoumission} disabled={submitDisabled}>
          <Send size={14} className="mr-1" /> {saveDemande.isPending ? "Envoi…" : "Soumettre la demande"}
        </Button>
      </div>
    </div>
  );
}
