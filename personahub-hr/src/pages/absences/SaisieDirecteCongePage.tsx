/**
 * SaisieDirecteCongePage.tsx — Saisie directe d'une CONSOMMATION de congé par le RH / l'Admin.
 *
 * IMPORTANT : cet écran n'écrit PAS dans `cong_demandes` et ne déclenche AUCUN
 * circuit de validation. Il insère directement une ligne dans
 * `cong_consommation` (avec `demande_id = null`), ce qui déclenche
 * automatiquement le trigger `trg_cong_consommation_recalcul_solde` →
 * `recalculate_cong_solde()` côté base, qui recalcule `cong_solde` à partir
 * de `cong_droits`, `cong_consommation`, `cong_demandes` et `cong_reliquat`.
 *
 * Toutes les règles de gestion du formulaire standard restent appliquées :
 * calcul jours calendaires / ouvrés / ouvrables (avec jours fériés),
 * demi-journées, autorisation d'absence de plein droit, ancienneté minimale,
 * date de début > date de début de contrat, solde négatif interdit, durée
 * maximale, préavis, fractionnement, justificatif obligatoire (avertissement),
 * et chevauchement — vérifié ici contre `cong_demandes` (demandes en attente/
 * approuvées) ET `cong_consommation` (consommations déjà enregistrées), pour
 * éviter tout double-comptage puisqu'aucune demande n'existera pour cette
 * consommation.
 *
 * Accès réservé : administrateur OU gestionnaire_rh.
 *
 * ⚠️ Non couvert par cet écran (absence de colonne sur cong_consommation) :
 *    - Pas de champ "commentaire" (la table n'en a pas).
 *    - Pas de "consommation sur reliquat reporté" (colonne absente ;
 *      présente uniquement sur cong_demandes).
 */
import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check, CheckCircle2, ChevronsUpDown, Info, RefreshCw, ShieldAlert, TrendingUp, X, CalendarCheck,
} from "lucide-react";
import { db } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { calcJoursAvecType, calcDateFinAutoAbsence, calcDateRetour, typeJourLabel } from "./congeCalculs";

const ROLES_AUTORISES = ["administrateur", "gestionnaire_rh"];

interface Collaborateur { id: string; matricule: string; nom: string; prenom: string; code_genre: string; }
interface TypeConge {
  code: string; libelle: string; justificatif_obligatoire: boolean;
  population_criteres: Record<string, string[]> | null;
  code_type_jour: string | null;
  est_autorisation_absence: boolean;
  droit_legal_jours: number | null; droit_convention_jours: number | null;
  solde_negatif_autorise: boolean | null;
  duree_max: number | null;
  preavis_jours: number | null;
  controle_chevauchement: string | null;
  fractionnement_autorise: boolean | null;
  fractionnement_min_jours: number | null;
  anciennete_min_mois: number | null;
  interdit_reliquat: boolean;
}
interface Solde { solde_acquis: number; solde_pris: number; solde_en_attente: number; solde_restant: number; reliquat_reporte: number; }

const EMPTY_FORM = {
  collaborateur_id: "", code_type_conge: "",
  date_debut: "", date_fin_absence: "", date_retour: "",
  debut_demi_journee: "", fin_demi_journee: "",
  nbr_jours_calendaires: 0, nbr_jours_decomptes: 0,
};

const SaisieDirecteCongePage: React.FC = () => {
  const { role } = useAuth() as any;
  const qc = useQueryClient();
  const autorise = ROLES_AUTORISES.includes(String(role || "").toLowerCase());

  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [openCollabPicker, setOpenCollabPicker] = useState(false);

  const exercice = useMemo(
    () => (form.date_debut ? new Date(form.date_debut + "T00:00:00").getFullYear() : new Date().getFullYear()),
    [form.date_debut],
  );

  // ── Données de référence ──────────────────────────────────────────────────
  const { data: collaborateurs = [] } = useQuery<Collaborateur[]>({
    queryKey: ["collabs-saisie-directe"],
    queryFn: async () => {
      try { return await db.list<Collaborateur>("collaborateurs", { select: "id,matricule,nom,prenom,code_genre", order: "nom" }); }
      catch { return []; }
    },
    enabled: autorise,
    staleTime: 5 * 60 * 1000,
  });

  const { data: typesConge = [] } = useQuery<TypeConge[]>({
    queryKey: ["ref-type-conge-avec-criteres-v4"],
    enabled: autorise,
    queryFn: async () => {
      const rows = await db.list<any>("ref_type_conge", { actif: true, order: "ordre" });
      return rows.map((r) => {
        const raw = r.population_criteres as any;
        const population_criteres = raw ? {
          genres: Array.isArray(raw.genres) ? raw.genres : [],
          categories_pro: Array.isArray(raw.categories_pro) ? raw.categories_pro : [],
          types_contrat: Array.isArray(raw.types_contrat) ? raw.types_contrat : [],
        } : null;
        return { ...r, population_criteres };
      }) as TypeConge[];
    },
  });

  const { data: feriesSet = new Set<string>() } = useQuery<Set<string>>({
    queryKey: ["jours-feries-calcul-v2", exercice],
    enabled: autorise,
    queryFn: async () => {
      const data = await db.list<{ date_debut: string; nombre_jours: number | null }>("ref_jours_feries", {
        select: "date_debut,nombre_jours", date_debut: `gte.${exercice}-01-01`,
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

  const { data: soldeForm } = useQuery<Solde | null>({
    queryKey: ["cong-solde-form-direct", form.collaborateur_id, form.code_type_conge, exercice],
    enabled: autorise && !!form.collaborateur_id && !!form.code_type_conge,
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

  const { data: dateDebutContrat = null } = useQuery<string | null>({
    queryKey: ["contrat-actif-date-debut", form.collaborateur_id],
    enabled: autorise && !!form.collaborateur_id,
    queryFn: async () => {
      const row = await db.findOne<{ date_debut: string }>("collaborateur_contrats", {
        select: "date_debut", collaborateur_id: form.collaborateur_id, code_statut_contrat: "ACTIF",
        archive: false, "date_sortie__isnull": true, order: "-date_debut",
      });
      return row?.date_debut ?? null;
    },
  });

  // ── Derived ────────────────────────────────────────────────────────────
  const collabSel = useMemo(() => collaborateurs.find((c) => c.id === form.collaborateur_id) || null, [collaborateurs, form.collaborateur_id]);
  const typeCongeActif = useMemo(() => form.code_type_conge ? (typesConge.find((t) => t.code === form.code_type_conge) || null) : null, [form.code_type_conge, typesConge]);
  const typeJourActif = useMemo(() => typeCongeActif?.code_type_jour || null, [typeCongeActif]);
  const isAutoAbsence = useMemo(() => !!typeCongeActif?.est_autorisation_absence, [typeCongeActif]);
  const droitAutoAbsence = useMemo(() => !typeCongeActif?.est_autorisation_absence ? 0 : (typeCongeActif.droit_convention_jours ?? typeCongeActif.droit_legal_jours ?? 0), [typeCongeActif]);
  const soldeDisponibleControle = useMemo(() => !typeCongeActif?.interdit_reliquat ? null : Number(soldeForm?.solde_restant ?? 0) - Number(soldeForm?.solde_en_attente ?? 0), [typeCongeActif, soldeForm]);

  const erreurDateContrat = useMemo(() => {
    if (!form.date_debut || !dateDebutContrat) return null;
    const dc = new Date(form.date_debut + "T00:00:00"), dk = new Date(dateDebutContrat + "T00:00:00");
    if (dc <= dk) return `La date de début du congé (${dc.toLocaleDateString("fr-FR")}) doit être strictement postérieure à la date de début du contrat (${dk.toLocaleDateString("fr-FR")}).`;
    return null;
  }, [form.date_debut, dateDebutContrat]);

  const erreurAnciennete = useMemo(() => {
    const min = typeCongeActif?.anciennete_min_mois ?? null;
    if (min == null || min <= 0 || !dateDebutContrat || !form.date_debut) return null;
    const [cy, cm, cd] = form.date_debut.split("-").map(Number);
    const [ky, km, kd] = dateDebutContrat.split("-").map(Number);
    const mois = (cy - ky) * 12 + (cm - km) - (cd < kd ? 1 : 0);
    if (mois < min) { const manque = min - mois; return `Ancienneté insuffisante. Actuelle : ${mois} mois — minimum requis : ${min} mois (encore ${manque} mois manquant${manque > 1 ? "s" : ""}).`; }
    return null;
  }, [typeCongeActif, dateDebutContrat, form.date_debut]);

  const soldeApresDemande = useMemo(() => {
    if (!soldeForm) return null;
    return Number(soldeForm.solde_restant ?? 0) - Number(form.nbr_jours_decomptes ?? 0);
  }, [soldeForm, form.nbr_jours_decomptes]);

  const typesCongeDisponibles = useMemo(() => {
    if (!collabSel?.code_genre) return typesConge;
    return typesConge.filter((t) => {
      const g = t.population_criteres?.genres;
      if (!g || g.length === 0) return true;
      return g.includes(collabSel.code_genre);
    });
  }, [typesConge, collabSel]);

  // ── Validations RG (identiques au formulaire standard) ─────────────────
  const validations = useMemo(() => {
    const v: { regle: string; message: string; bloquant: boolean }[] = [];
    const tc = typeCongeActif;
    if (!tc || !form.date_debut || !form.date_fin_absence) return v;

    if (new Date(form.date_fin_absence) < new Date(form.date_debut)) {
      v.push({ regle: "dates", message: "La date de fin doit être postérieure ou égale à la date de début.", bloquant: true });
    }
    if (erreurDateContrat) v.push({ regle: "contrat", message: erreurDateContrat, bloquant: true });
    if (erreurAnciennete) v.push({ regle: "anciennete", message: erreurAnciennete, bloquant: true });
    if (tc.solde_negatif_autorise === false && soldeApresDemande != null && soldeApresDemande < 0) {
      v.push({ regle: "solde", message: `Solde insuffisant : le solde après consommation serait de ${soldeApresDemande.toFixed(1)} j. Ce type de congé n'autorise pas le solde négatif.`, bloquant: true });
    }
    if (tc.duree_max != null && tc.duree_max > 0 && Number(form.nbr_jours_decomptes) > tc.duree_max) {
      v.push({ regle: "duree_max", message: `Durée maximale dépassée : ${Number(form.nbr_jours_decomptes).toFixed(1)} j pour un maximum de ${tc.duree_max} j.`, bloquant: true });
    }
    if (tc.fractionnement_autorise === false && tc.fractionnement_min_jours != null && tc.fractionnement_min_jours > 0
        && Number(form.nbr_jours_decomptes) < tc.fractionnement_min_jours) {
      v.push({ regle: "fractionnement", message: `Fractionnement non autorisé en deçà de ${tc.fractionnement_min_jours} j (durée : ${Number(form.nbr_jours_decomptes).toFixed(1)} j).`, bloquant: true });
    }
    if (tc.justificatif_obligatoire) {
      v.push({ regle: "justificatif", message: "Ce type de congé requiert une pièce justificative. Pensez à la classer au dossier du collaborateur.", bloquant: false });
    }
    return v;
  }, [typeCongeActif, form.date_debut, form.date_fin_absence, form.nbr_jours_decomptes, erreurDateContrat, erreurAnciennete, soldeApresDemande]);

  // Chevauchement : contre cong_demandes (en attente/approuvée) ET cong_consommation
  // (puisqu'aucune demande n'existera pour CETTE consommation).
  const { data: chevauchement = null } = useQuery<{ libelle: string; debut: string; fin: string; source: string } | null>({
    queryKey: ["chevauchement-conge-direct", form.collaborateur_id, form.date_debut, form.date_fin_absence],
    enabled: autorise && !!form.collaborateur_id && !!form.date_debut && !!form.date_fin_absence
      && (typeCongeActif?.controle_chevauchement ?? "STRICT") === "STRICT",
    queryFn: async () => {
      const [demandes, conso] = await Promise.all([
        db.list<any>("cong_demandes", {
          select: "id,date_debut,date_fin_absence,code_type_conge,statut",
          collaborateur_id: form.collaborateur_id,
          date_debut: `lte.${form.date_fin_absence}`, date_fin_absence: `gte.${form.date_debut}`,
        }),
        db.list<any>("cong_consommation", {
          select: "id,date_debut,date_retour,code_type_conge,est_annulee",
          collaborateur_id: form.collaborateur_id, est_annulee: false, archive: false,
          date_debut: `lte.${form.date_fin_absence}`, date_retour: `gte.${form.date_debut}`,
        }),
      ]);
      const STATUTS_BLOQUANTS = ["en_attente", "approuvee", "brouillon", "modifiee"];
      const ovD = (demandes || []).find((r) => STATUTS_BLOQUANTS.includes(String(r.statut ?? "").toLowerCase()));
      if (ovD) {
        const t = typesConge.find((x) => x.code === ovD.code_type_conge);
        return { libelle: t?.libelle || ovD.code_type_conge, debut: ovD.date_debut, fin: ovD.date_fin_absence, source: "demande en cours" };
      }
      const ovC = (conso || [])[0];
      if (ovC) {
        const t = typesConge.find((x) => x.code === ovC.code_type_conge);
        return { libelle: t?.libelle || ovC.code_type_conge, debut: ovC.date_debut, fin: ovC.date_retour, source: "congé déjà enregistré" };
      }
      return null;
    },
  });

  const toutesViolations = useMemo(() => {
    const list = [...validations];
    if (chevauchement) {
      list.push({
        regle: "chevauchement",
        message: `Chevauchement : un(e) ${chevauchement.source} "${chevauchement.libelle}" du ${new Date(chevauchement.debut).toLocaleDateString("fr-FR")} au ${new Date(chevauchement.fin).toLocaleDateString("fr-FR")} existe déjà.`,
        bloquant: true,
      });
    }
    return list;
  }, [validations, chevauchement]);
  const violationsBloquantes = useMemo(() => toutesViolations.filter((x) => x.bloquant), [toutesViolations]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const updateFormDates = (updates: Partial<typeof form>) => {
    const merged = { ...form, ...updates };
    const { cal, dec } = calcJoursAvecType(merged.date_debut, merged.date_fin_absence, merged.debut_demi_journee, merged.fin_demi_journee, typeJourActif, feriesSet);
    const retour = calcDateRetour(merged.date_fin_absence, merged.fin_demi_journee, typeJourActif, feriesSet);
    setForm((f) => ({ ...f, ...updates, nbr_jours_calendaires: cal, nbr_jours_decomptes: dec, date_retour: retour }));
  };
  const handleTypeCongeChange = (code: string) => {
    const tc = typesConge.find((t) => t.code === code);
    const newTypeJour = tc?.code_type_jour || null;
    const isAutoAbs = !!tc?.est_autorisation_absence;
    const droit = tc?.droit_convention_jours ?? tc?.droit_legal_jours ?? 0;
    let newDateFin = form.date_fin_absence;
    if (isAutoAbs && droit > 0 && form.date_debut) newDateFin = calcDateFinAutoAbsence(form.date_debut, droit);
    const { cal, dec } = calcJoursAvecType(form.date_debut, newDateFin, form.debut_demi_journee, form.fin_demi_journee, newTypeJour, feriesSet);
    const retour = calcDateRetour(newDateFin, form.fin_demi_journee, newTypeJour, feriesSet);
    setForm((f) => ({ ...f, code_type_conge: code, date_fin_absence: newDateFin, nbr_jours_calendaires: cal, nbr_jours_decomptes: dec, date_retour: retour }));
  };
  const handleDateDebutAutoAbs = (dateDebut: string) => {
    if (!isAutoAbsence || droitAutoAbsence <= 0) { updateFormDates({ date_debut: dateDebut }); return; }
    const newDateFin = calcDateFinAutoAbsence(dateDebut, droitAutoAbsence);
    const { cal, dec } = calcJoursAvecType(dateDebut, newDateFin, form.debut_demi_journee, form.fin_demi_journee, typeJourActif, feriesSet);
    const retour = calcDateRetour(newDateFin, form.fin_demi_journee, typeJourActif, feriesSet);
    setForm((f) => ({ ...f, date_debut: dateDebut, date_fin_absence: newDateFin, nbr_jours_calendaires: cal, nbr_jours_decomptes: dec, date_retour: retour }));
  };

  // ── Enregistrement : INSERT direct dans cong_consommation ───────────────
  const enregistrer = useMutation({
    mutationFn: async () => {
      if (violationsBloquantes.length > 0) throw new Error(violationsBloquantes.map((x) => "• " + x.message).join("\n"));
      if (typeCongeActif?.interdit_reliquat) {
        const disponible = Number(soldeDisponibleControle ?? 0);
        if (form.nbr_jours_decomptes > disponible) throw new Error(`Solde insuffisant : ${form.nbr_jours_decomptes.toFixed(1)}j demandés pour ${disponible.toFixed(1)}j disponibles.`);
      }
      await db.create("cong_consommation", {
        collaborateur_id: form.collaborateur_id,
        code_type_conge: form.code_type_conge,
        demande_id: null,
        date_debut: form.date_debut,
        date_fin_absence: form.date_fin_absence,
        date_retour: form.date_retour,
        nbr_jours_calendaires: form.nbr_jours_calendaires,
        nbr_jours_decomptes: form.nbr_jours_decomptes,
        debut_demi_journee: form.debut_demi_journee || null,
        fin_demi_journee: form.fin_demi_journee || null,
        est_annulee: false,
        exercice,
        archive: false,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cong-soldes"] });
      qc.invalidateQueries({ queryKey: ["mes-soldes"] });
      qc.invalidateQueries({ queryKey: ["cong-solde-form-direct"] });
      toast({ title: "Congé enregistré", description: `${collabSel?.prenom} ${collabSel?.nom} — solde mis à jour immédiatement.` });
      setForm({ ...EMPTY_FORM });
    },
    onError: (e: Error) => toast({ title: "Erreur d'enregistrement", description: e.message, variant: "destructive" }),
  });

  const submitDisabled = enregistrer.isPending || !form.collaborateur_id || !form.code_type_conge || !form.date_debut || !form.date_fin_absence
    || !!(typeCongeActif?.interdit_reliquat && form.nbr_jours_decomptes > Number(soldeDisponibleControle ?? 0))
    || violationsBloquantes.length > 0;

  const tenterEnregistrement = () => {
    if (violationsBloquantes.length > 0) {
      toast({
        title: violationsBloquantes.length > 1 ? `${violationsBloquantes.length} règles bloquent l'enregistrement` : "Règle non respectée",
        description: violationsBloquantes.map((x) => "• " + x.message).join("\n"),
        variant: "destructive",
      });
      return;
    }
    const avertissements = toutesViolations.filter((x) => !x.bloquant);
    if (avertissements.length > 0) toast({ title: "À noter", description: avertissements.map((x) => "• " + x.message).join("\n") });
    enregistrer.mutate();
  };

  // ── Garde d'accès ─────────────────────────────────────────────────────────
  if (!autorise) {
    return (
      <div className="max-w-lg mx-auto mt-16 p-8 rounded-2xl text-center" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
        <ShieldAlert size={40} className="mx-auto mb-3" style={{ color: "hsl(0 70% 50%)" }} />
        <h2 className="text-lg font-bold mb-1" style={{ color: "hsl(var(--foreground))" }}>Accès restreint</h2>
        <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
          La saisie directe de congé est réservée aux profils <strong>Administrateur</strong> et <strong>Gestionnaire RH</strong>.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-6 px-4">
      {/* En-tête */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }}>
          <CalendarCheck size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold" style={{ color: "hsl(var(--foreground))" }}>Saisie directe d'un congé</h1>
          <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Consommation enregistrée immédiatement — exercice {exercice}</p>
        </div>
      </div>

      {/* Bandeau explicatif */}
      <div className="flex items-start gap-2 p-3 rounded-xl mb-5" style={{ background: "hsl(210 90% 55% / 0.08)", border: "1px solid hsl(210 90% 55% / 0.25)" }}>
        <Info size={16} className="mt-0.5 flex-shrink-0" style={{ color: "hsl(210 90% 45%)" }} />
        <p className="text-[13px]" style={{ color: "hsl(var(--foreground))" }}>
          Ce congé est enregistré <strong>directement en consommation</strong> — aucune demande n'est créée, aucun
          circuit de validation n'est déclenché. Le solde est recalculé automatiquement. Toutes les règles de
          gestion (solde, ancienneté, préavis, fractionnement, chevauchement…) restent appliquées.
        </p>
      </div>

      <div className="p-5 rounded-2xl space-y-5" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>

        {/* Collaborateur + type */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>Collaborateur *</Label>
            <Popover open={openCollabPicker} onOpenChange={setOpenCollabPicker}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={openCollabPicker} className="w-full justify-between font-normal">
                  {collabSel ? `${collabSel.nom} ${collabSel.prenom} (${collabSel.matricule})` : "Sélectionner…"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command filter={(value, search) => { const c = collaborateurs.find((x) => x.id === value); if (!c) return 0; return `${c.nom} ${c.prenom} ${c.matricule}`.toLowerCase().includes(search.toLowerCase()) ? 1 : 0; }}>
                  <CommandInput placeholder="Rechercher un collaborateur…" autoFocus />
                  <CommandList>
                    <CommandEmpty>Aucun collaborateur trouvé.</CommandEmpty>
                    <CommandGroup>
                      {collaborateurs.map((c) => (
                        <CommandItem key={c.id} value={c.id} onSelect={() => { setForm((f) => ({ ...f, collaborateur_id: c.id, code_type_conge: "" })); setOpenCollabPicker(false); }}>
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

        {/* Solde */}
        {form.collaborateur_id && form.code_type_conge && !isAutoAbsence && (
          <div className="rounded-lg p-3 border grid grid-cols-4 gap-3" style={{ background: "hsl(var(--muted)/0.4)", borderColor: "hsl(var(--border))" }}>
            <div className="text-center"><p className="text-xs mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Acquis</p><p className="text-lg font-bold" style={{ color: "hsl(var(--foreground))" }}>{soldeForm ? Number(soldeForm.solde_acquis).toFixed(1) : "—"}</p></div>
            <div className="text-center"><p className="text-xs mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Pris</p><p className="text-lg font-bold" style={{ color: "hsl(var(--foreground))" }}>{soldeForm ? Number(soldeForm.solde_pris).toFixed(1) : "—"}</p></div>
            <div className="text-center"><p className="text-xs mb-0.5 flex items-center justify-center gap-1" style={{ color: "hsl(var(--muted-foreground))" }}><RefreshCw size={10} /> Reliquat</p><p className="text-lg font-bold" style={{ color: soldeForm && soldeForm.reliquat_reporte > 0 ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}>{soldeForm ? Number(soldeForm.reliquat_reporte).toFixed(1) : "—"}</p></div>
            <div className="text-center"><p className="text-xs mb-0.5 flex items-center justify-center gap-1" style={{ color: "hsl(var(--muted-foreground))" }}><TrendingUp size={10} /> Restant</p>{soldeForm ? (<p className="text-lg font-bold" style={{ color: soldeForm.solde_restant < 0 ? "hsl(0 72% 51%)" : soldeForm.solde_restant < 3 ? "hsl(38 92% 50%)" : "hsl(142 71% 45%)" }}>{Number(soldeForm.solde_restant).toFixed(1)}</p>) : (<p className="text-lg font-bold" style={{ color: "hsl(var(--muted-foreground))" }}>—</p>)}</div>
            {!soldeForm && (<p className="col-span-4 text-xs text-center" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun solde enregistré pour cet exercice {exercice}</p>)}
          </div>
        )}
        {form.collaborateur_id && form.code_type_conge && isAutoAbsence && (
          <div className="rounded-lg p-3 flex items-center gap-3 border" style={{ background: "hsl(142 60% 45% / 0.06)", borderColor: "hsl(142 60% 45% / 0.3)" }}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "hsl(142 60% 45% / 0.15)" }}><Check size={16} style={{ color: "hsl(142 60% 35%)" }} /></div>
            <div><p className="text-sm font-semibold" style={{ color: "hsl(142 60% 30%)" }}>Autorisation d'absence accordée de plein droit</p><p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Ce type de congé ne nécessite pas de solde — {droitAutoAbsence}j accordés automatiquement selon les droits paramétrés.</p></div>
          </div>
        )}

        {/* Date début */}
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label>Date de début *</Label>
            <Input type="date" value={form.date_debut} onChange={(e) => handleDateDebutAutoAbs(e.target.value)} style={erreurDateContrat ? { borderColor: "hsl(var(--destructive))" } : {}} />
            {erreurDateContrat && (<div className="flex items-start gap-1.5 mt-1"><span style={{ color: "hsl(0 72% 51%)", flexShrink: 0 }}>⚠</span><p className="text-xs leading-tight" style={{ color: "hsl(0 72% 45%)" }}>{erreurDateContrat}</p></div>)}
            {erreurAnciennete && !erreurDateContrat && (<div className="flex items-start gap-1.5 mt-1"><span style={{ color: "hsl(0 72% 51%)", flexShrink: 0 }}>⚠</span><p className="text-xs leading-tight" style={{ color: "hsl(0 72% 45%)" }}>{erreurAnciennete}</p></div>)}
          </div>
          <div className="space-y-1">
            <Label>Demi-journée début</Label>
            <Select value={form.debut_demi_journee || "JOURNEE"} onValueChange={(v) => updateFormDates({ debut_demi_journee: v === "JOURNEE" ? "" : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="JOURNEE">Journée entière</SelectItem><SelectItem value="MATIN">Demi-journée matin</SelectItem><SelectItem value="APRES_MIDI">Demi-journée après-midi</SelectItem></SelectContent>
            </Select>
          </div>
          <div></div>
        </div>

        {/* Fin + retour */}
        {isAutoAbsence ? (
          <div className="rounded-lg border p-3 grid grid-cols-3 gap-4" style={{ background: "hsl(142 60% 45% / 0.06)", borderColor: "hsl(142 60% 45% / 0.3)" }}>
            <div className="col-span-3 flex items-center gap-2 mb-1"><span className="text-xs font-semibold" style={{ color: "hsl(142 60% 35%)" }}>✓ Autorisation d'absence — {droitAutoAbsence}j accordés de plein droit</span></div>
            <div className="space-y-1"><Label>Date de fin absence</Label><Input type="date" value={form.date_fin_absence} readOnly className="cursor-not-allowed" /></div>
            <div className="space-y-1"><Label>Date de retour</Label><Input type="date" value={form.date_retour} readOnly className="cursor-not-allowed" /></div>
            <div></div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1"><Label>Date de fin absence *</Label><Input type="date" value={form.date_fin_absence} min={form.date_debut || undefined} onChange={(e) => updateFormDates({ date_fin_absence: e.target.value })} /></div>
            <div className="space-y-1"><Label>Demi-journée fin</Label><Select value={form.fin_demi_journee || "JOURNEE"} onValueChange={(v) => updateFormDates({ fin_demi_journee: v === "JOURNEE" ? "" : v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="JOURNEE">Journée entière</SelectItem><SelectItem value="MATIN">Demi-journée matin</SelectItem><SelectItem value="APRES_MIDI">Demi-journée après-midi</SelectItem></SelectContent></Select></div>
            <div className="space-y-1"><Label>Date de retour</Label><Input type="date" value={form.date_retour} readOnly className="bg-muted cursor-not-allowed" /></div>
          </div>
        )}

        {/* Récap jours */}
        {form.date_debut && form.date_fin_absence && (
          <div className="p-3 rounded-lg grid grid-cols-3 gap-4" style={{ background: "hsl(var(--primary)/0.08)" }}>
            <div><span className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Jours calendaires</span><div className="text-2xl font-bold" style={{ color: "hsl(var(--primary))" }}>{Number(form.nbr_jours_calendaires).toFixed(1)}</div></div>
            <div><span className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Jours décomptés ({typeJourLabel(typeJourActif)})</span><div className="text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>{Number(form.nbr_jours_decomptes).toFixed(1)}</div></div>
            {soldeForm && (<div><span className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Solde après enregistrement</span><div className="text-2xl font-bold" style={{ color: (soldeForm.solde_restant - form.nbr_jours_decomptes) < 0 ? "hsl(0 72% 51%)" : "hsl(142 71% 45%)" }}>{(soldeForm.solde_restant - form.nbr_jours_decomptes).toFixed(1)}</div></div>)}
          </div>
        )}

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

        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={tenterEnregistrement} disabled={submitDisabled}>
            <CheckCircle2 size={14} className="mr-1" /> {enregistrer.isPending ? "Enregistrement…" : "Enregistrer le congé"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SaisieDirecteCongePage;
