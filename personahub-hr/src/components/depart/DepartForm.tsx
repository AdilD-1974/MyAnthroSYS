import React, { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  X, DoorOpen, AlertTriangle, Info, CalendarDays,
  ChevronRight, ChevronLeft, User, FileText,
  Briefcase, Shield, Upload, Check, Building2,
  UserCircle2, Calculator, Clock, CheckCircle, TrendingDown,
} from "lucide-react";
import { format, isPast, isToday, parseISO, addDays, differenceInYears } from "date-fns";
import { fr } from "date-fns/locale";

// ─── Types ────────────────────────────────────────────────────────────────────
const MOTIFS_DEPART = [
  "Démission",
  "Fin de contrat (CDD)",
  "Licenciement pour faute grave",
  "Licenciement pour faute lourde",
  "Licenciement économique",
  "Retraite",
  "Retraite anticipée",
  "Rupture conventionnelle",
  "Décès",
  "Invalidité",
  "Abandon de poste",
  "Mobilité externe",
  "Fin de mission",
  "Révocation",
  "Autre",
];

// Motifs avec droit préavis selon CT Maroc
const MOTIFS_AVEC_PREAVIS = [
  "Démission",
  "Licenciement pour faute grave",
  "Licenciement pour faute lourde",
  "Licenciement économique",
  "Retraite",
  "Rupture conventionnelle",
];

// Motifs avec indemnité légale (Art.52-53 CT Maroc)
const MOTIFS_AVEC_INDEMNITE = [
  "Licenciement pour faute grave",
  "Licenciement pour faute lourde",
  "Licenciement économique",
  "Retraite",
  "Retraite anticipée",
  "Rupture conventionnelle",
  "Invalidité",
];

const DOCS_LIST = [
  { key: "doc_attestation_travail",       label: "Attestation de travail" },
  { key: "doc_recu_stc",                  label: "Reçu solde de tout compte (STC)" },
  { key: "doc_radiation_cnss",            label: "Attestation radiation CNSS" },
  { key: "doc_attestation_amo",           label: "Clôture couverture AMO" },
  { key: "doc_certificat_conges",         label: "Certificat solde de congés" },
  { key: "doc_lettre_notification",       label: "Lettre de notification" },
  { key: "doc_accord_amiable",            label: "Accord amiable / protocole transactionnel" },
  { key: "doc_pv_entretien",              label: "PV entretien préalable (licenciement CDI)" },
  { key: "doc_recu_materiel",             label: "Reçu restitution matériel" },
];

const MATERIEL_LIST = [
  { key: "materiel_badge_restitue",       label: "Badge / accès" },
  { key: "materiel_ordinateur_restitue",  label: "Ordinateur" },
  { key: "materiel_vehicule_restitue",    label: "Véhicule de fonction" },
  { key: "materiel_telephone_restitue",   label: "Téléphone professionnel" },
];

// ─── Calcul préavis légal marocain (Art.43-51 CT) ─────────────────────────────
function calcPreavisLegal(codeTypeContrat: string, ancienneteAns: number, categorie: string): number {
  if (codeTypeContrat === "CDD") return 0; // CDD : pas de préavis légal
  // CDI selon catégorie et ancienneté (Art.43 CT Maroc)
  if (categorie === "CADRE") {
    if (ancienneteAns < 1)  return 30;
    if (ancienneteAns < 5)  return 60;
    return 90;
  }
  // Exécution / Maîtrise
  if (ancienneteAns < 1)  return 8;
  if (ancienneteAns < 5)  return 30;
  return 60;
}

// ─── Calcul indemnité légale marocaine (Art.53 CT) ────────────────────────────
function calcIndemniteLegale(salaireMensuel: number, ancienneteAns: number, motif: string): number {
  if (!MOTIFS_AVEC_INDEMNITE.includes(motif)) return 0;
  if (ancienneteAns < 1) return 0;
  // 96h de salaire par année d'ancienneté (Art.53)
  const tauxHoraire = salaireMensuel / 191; // 191h/mois légal Maroc
  return Math.round(tauxHoraire * 96 * ancienneteAns * 100) / 100;
}

// ─── Stepper ──────────────────────────────────────────────────────────────────
const STEPS = [
  { id: 0, label: "Départ",        icon: <DoorOpen size={14} /> },
  { id: 1, label: "Préavis",       icon: <Clock size={14} /> },
  { id: 2, label: "Indemnités",    icon: <Calculator size={14} /> },
  { id: 3, label: "Administratif", icon: <Shield size={14} /> },
  { id: 4, label: "Documents",     icon: <FileText size={14} /> },
  { id: 5, label: "Récapitulatif", icon: <CheckCircle size={14} /> },
];

// ─── Composant principal ──────────────────────────────────────────────────────
interface Props {
  collaborateurId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

const DepartForm: React.FC<Props> = ({ collaborateurId, onClose, onSuccess }) => {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [searchCollab, setSearchCollab] = useState("");
  const [selectedCollabData, setSelectedCollabData] = useState<any>(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  // ── Contexte collab (alimenté par collabContext query) ────────────────────
  const [contrat, setContrat] = useState<any>(null);
  const [affectation, setAffectation] = useState<any>(null);
  const [collabInfo, setCollabInfo] = useState<any>(null);

  // ── Formulaire principal ─────────────────────────────────────────────────
  const [form, setForm] = useState({
    collaborateur_id: collaborateurId ?? "",
    date_depart: "",
    motif_depart: "",
    commentaire: "",
    reference_decision: "",
    date_notification: "",
    date_entretien_prealable: "",
    decision_finale: "ACCEPTE",

    // Préavis
    preavis_duree_jours: "" as string | number,
    preavis_date_debut: "",
    preavis_date_fin: "",
    preavis_dispense: false,
    preavis_dispense_indemnite: "" as string | number,
    preavis_effectue: false,
    preavis_categorie: "EXECUTION",

    // Indemnités
    base_calcul_salaire: "" as string | number,
    anciennete_retenue_ans: "" as string | number,
    indemnite_perte_emploi: "" as string | number,
    indemnite_depart_retraite: "" as string | number,
    indemnite_conges_payes: "" as string | number,
    indemnite_compensatrice: "" as string | number,
    indemnite_transactionnelle: "" as string | number,
    indemnite_anciennete: "" as string | number,
    indemnite_13eme_mois: "" as string | number,
    solde_conges_jours: "" as string | number,

    // CNSS / AMO
    cnss_radiation_date: "",
    cnss_derniere_declaration: "",
    amo_cloture_date: "",
    amo_attestation_delivree: false,

    // Documents checklist
    doc_attestation_travail: false,
    doc_recu_stc: false,
    doc_radiation_cnss: false,
    doc_attestation_amo: false,
    doc_certificat_conges: false,
    doc_lettre_notification: false,
    doc_accord_amiable: false,
    doc_pv_entretien: false,
    doc_recu_materiel: false,

    // Chemins uploads
    doc_attestation_travail_path: "",
    doc_recu_stc_path: "",
    doc_radiation_cnss_path: "",
    doc_attestation_amo_path: "",
    doc_certificat_conges_path: "",
    doc_lettre_notification_path: "",
    doc_accord_amiable_path: "",
    doc_pv_entretien_path: "",
    doc_recu_materiel_path: "",

    // Matériel
    materiel_badge_restitue: false,
    materiel_ordinateur_restitue: false,
    materiel_vehicule_restitue: false,
    materiel_telephone_restitue: false,
    acces_si_desactive: false,
    acces_email_desactive: false,
    acces_desactivation_date: "",
  });

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  // ── Helpers ───────────────────────────────────────────────────────────────
  const isImmediate = form.date_depart
    ? isPast(parseISO(form.date_depart)) || isToday(parseISO(form.date_depart))
    : false;

  const avecPreavis = MOTIFS_AVEC_PREAVIS.includes(form.motif_depart) && contrat?.code_type_contrat !== "CDD";
  const avecIndemnite = MOTIFS_AVEC_INDEMNITE.includes(form.motif_depart);
  const isCDI = contrat?.code_type_contrat === "CDI" || (!contrat?.code_type_contrat);
  const needsEntretien = isCDI && ["Licenciement pour faute grave","Licenciement pour faute lourde","Licenciement économique"].includes(form.motif_depart);

  const anciennete = collabInfo?.date_naissance && contrat?.date_debut
    ? differenceInYears(new Date(), parseISO(contrat.date_debut))
    : 0;

  // Total indemnités
  const totalIndemnites = [
    form.indemnite_perte_emploi,
    form.indemnite_depart_retraite,
    form.indemnite_conges_payes,
    form.indemnite_compensatrice,
    form.indemnite_transactionnelle,
    form.indemnite_anciennete,
    form.indemnite_13eme_mois,
  ].reduce((acc, v) => acc + (parseFloat(String(v)) || 0), 0);

  // ── Search collabs ────────────────────────────────────────────────────────
  // ── Tous les collabs actifs (chargé une fois, filtré côté JS) ────────────
  // Même pattern que DepartsProvisoiresPage qui fonctionne
  const { data: tousCollabs = [] } = useQuery<any[]>({
    queryKey: ["collabs-depart-form-all"],
    enabled: !collaborateurId,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const params = new URLSearchParams({
        select: "id,nom,prenom,matricule,statut_collaborateur,date_naissance,photo_path",
        statut_collaborateur: "in.(ACTIF,EN_DEPART)",
        archive: "eq.false",
        order: "nom",
        limit: "500",
      });
      return await api.get(`/db/collaborateurs?${params.toString()}`) || [];
    },
  });

  // Filtre JS insensible à la casse et aux accents (multi-tokens)
  const normTxt = (s: string) =>
    (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  const collaborateurs = useMemo(() => {
    const q = normTxt(searchCollab.trim());
    if (!q || q.length < 2) return [];
    const tokens = q.split(/\s+/).filter(Boolean);
    return tousCollabs.filter((c: any) => {
      const hay = normTxt(`${c.matricule || ""} ${c.nom || ""} ${c.prenom || ""}`);
      return tokens.every(t => hay.includes(t));
    }).slice(0, 50);
  }, [tousCollabs, searchCollab]);

  const selectedCollab = selectedCollabData ?? collaborateurs.find((c: any) => c.id === form.collaborateur_id) ?? collabInfo;

  // ── Référentiels couleurs ─────────────────────────────────────────────────
  const { data: typesContrats = [] } = useQuery<any[]>({
    queryKey: ["ref_type_contrat-depart-form"],
    queryFn: async () => { try { return await api.get("/db/ref_type_contrat"); } catch { return []; } },
    staleTime: 5 * 60 * 1000,
  });
  const { data: statutsContrat = [] } = useQuery<any[]>({
    queryKey: ["ref_statut_contrat-depart-form"],
    queryFn: async () => { try { return await api.get("/db/ref_statut_contrat"); } catch { return []; } },
    staleTime: 5 * 60 * 1000,
  });

  // ── Fenêtre de dates autorisée (parametres_rh) ────────────────────────────
  // RG-DEP-FENETRE-01 : DateSystème - NombreJ_passé <= DtDep <= DateSystème + NombreJ_futur
  const { data: fenetreParams } = useQuery({
    queryKey: ["parametres-depart-fenetre"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      try {
        const data: any[] = await api.get(
          "/db/parametres_rh?code=in.(DEPART_FENETRE_PASSE_J,DEPART_FENETRE_FUTUR_J)&actif=eq.true&select=code,valeur"
        );
        const map: Record<string, number> = {};
        (data || []).forEach(p => { map[p.code] = parseInt(p.valeur, 10) || 0; });
        return {
          passé: map["DEPART_FENETRE_PASSE_J"] ?? 90,   // défaut : 90j dans le passé
          futur: map["DEPART_FENETRE_FUTUR_J"] ?? 365,  // défaut : 1 an dans le futur
        };
      } catch {
        return { passé: 90, futur: 365 };
      }
    },
  });

  const fenetrePasseJ = fenetreParams?.passé ?? 90;
  const fenetreFuturJ = fenetreParams?.futur ?? 365;

  // Dates limites calculées
  const dateMinDepart = format(addDays(new Date(), -fenetrePasseJ), "yyyy-MM-dd");
  const dateMaxDepart = format(addDays(new Date(), fenetreFuturJ), "yyyy-MM-dd");

  // Validation de la fenêtre date départ
  const dateDepartErreur: string | null = (() => {
    if (!form.date_depart) return null;
    if (form.date_depart < dateMinDepart) {
      return `La date de départ ne peut pas être antérieure de plus de ${fenetrePasseJ} jour(s) à la date du jour (min : ${format(parseISO(dateMinDepart), "dd/MM/yyyy", { locale: fr })}).`;
    }
    if (form.date_depart > dateMaxDepart) {
      return `La date de départ ne peut pas dépasser ${fenetreFuturJ} jour(s) dans le futur (max : ${format(parseISO(dateMaxDepart), "dd/MM/yyyy", { locale: fr })}).`;
    }
    return null;
  })();

  // RG-DEP-NOTIF-01 : date_notification dans la même fenêtre ET <= date_depart
  const dateNotifErreur: string | null = (() => {
    if (!form.date_notification) return null;
    if (form.date_notification < dateMinDepart) {
      return `La date de notification ne peut pas être antérieure de plus de ${fenetrePasseJ} jour(s) à la date du jour (min : ${format(parseISO(dateMinDepart), "dd/MM/yyyy", { locale: fr })}).`;
    }
    if (form.date_notification > dateMaxDepart) {
      return `La date de notification ne peut pas dépasser ${fenetreFuturJ} jour(s) dans le futur (max : ${format(parseISO(dateMaxDepart), "dd/MM/yyyy", { locale: fr })}).`;
    }
    if (form.date_depart && form.date_notification > form.date_depart) {
      return `La date de notification doit être inférieure ou égale à la date de départ (${format(parseISO(form.date_depart), "dd/MM/yyyy", { locale: fr })}).`;
    }
    return null;
  })();

  const getTypeContratInfo = (code?: string | null) => {
    if (!code) return { libelle: "", couleur: "hsl(210 80% 50%)" };
    const t = typesContrats.find((x: any) => x.code === code);
    return { libelle: t?.libelle || code, couleur: t?.couleur || "hsl(210 80% 50%)" };
  };
  const getStatutInfo = (code?: string | null) => {
    if (!code) return { libelle: "", couleur: "hsl(0 0% 50%)" };
    const s = statutsContrat.find((x: any) => x.code === code);
    const fallback = (code === "ACTIF" || code === "EN_COURS") ? "hsl(140 60% 40%)" : "hsl(0 0% 50%)";
    return { libelle: s?.libelle || code, couleur: s?.couleur || fallback };
  };

  // ── Contexte collaborateur (contrat + affectation + photo) ────────────────
  const { data: collabContext, isLoading: loadingInfo } = useQuery({
    queryKey: ["collab-context-depart-form", form.collaborateur_id],
    enabled: !!form.collaborateur_id,
    queryFn: async () => {
      if (!form.collaborateur_id) return null;
      const today = new Date().toISOString().split("T")[0];

      let collabInfos: any = null;
      try {
        const c: any[] = await api.get(`/db/collaborateurs?id=eq.${form.collaborateur_id}&limit=1`);
        collabInfos = c?.[0] || null;
      } catch { /* ignore */ }

      let contrat: any = null;
      try {
        const contrats: any[] = await api.get(
          `/db/collaborateur_contrats?collaborateur_id=eq.${form.collaborateur_id}&archive=eq.false&date_sortie=is.null&order=date_debut.desc&limit=1`
        );
        contrat = contrats?.[0] || null;
      } catch {
        // Fallback sans filtre date_sortie
        try {
          const contrats: any[] = await api.get(
            `/db/collaborateur_contrats?collaborateur_id=eq.${form.collaborateur_id}&archive=eq.false&order=date_debut.desc&limit=1`
          );
          contrat = contrats?.[0] || null;
        } catch { /* ignore */ }
      }

      let aRaw: any = null;
      try {
        // Même pattern que DepartsProvisoiresPage — sans filtre archive sur affectations
        const affs: any[] = await api.get(
          `/db/collaborateur_affectations?collaborateur_id=eq.${form.collaborateur_id}&order=date_debut_uo.desc&limit=1`
        );
        aRaw = affs?.[0] || null;
        if (aRaw?.date_fin_uo && aRaw.date_fin_uo < today) aRaw = null;
      } catch { /* ignore */ }

      let uo: any = null;
      if (aRaw?.unite_id) {
        try {
          const uoData: any[] = await api.get(`/db/unites_organisationnelles?id=eq.${aRaw.unite_id}&limit=1`);
          uo = uoData?.[0] || null;
        } catch { /* ignore */ }
      }

      let poste: any = null;
      if (aRaw?.code_poste) {
        const codePosteInst = String(aRaw.code_poste);
        const codePosteParent = codePosteInst.split("-")[0];
        try {
          const vData: any[] = await api.get(`/db/v_postes_avec_instances?code_instance=eq.${encodeURIComponent(codePosteInst)}&limit=1`);
          if (vData?.[0]) poste = vData[0];
        } catch { /* continue */ }
        if (!poste?.libelle_poste && !poste?.libelle) {
          try {
            const rpData: any[] = await api.get(`/db/ref_poste?code=eq.${encodeURIComponent(codePosteParent)}&limit=1`);
            if (rpData?.[0]) poste = { ...(poste || {}), code_poste_parent: codePosteParent, ...rpData[0] };
          } catch { /* ignore */ }
        }
      }

      const affectation = aRaw ? {
        libelle_uo: uo?.libelle || uo?.intitule || uo?.nom || null,
        couleur_uo: uo?.couleur || uo?.color || null,
        code_instance_poste: aRaw.code_poste || null,
        code_poste_parent: poste?.code_poste_parent || poste?.code_poste || null,
        libelle_poste: poste?.libelle_poste || poste?.libelle || poste?.intitule || poste?.nom || null,
        date_debut_uo: aRaw.date_debut_uo || null,
        date_debut_poste: aRaw.date_debut_poste || null,
        raw: aRaw,
      } : null;

      return { contrat, affectation, collabInfos };
    },
  });

  // Sync contrat/ancienneté depuis collabContext
  useEffect(() => {
    const ct = collabContext?.contrat;
    setContrat(ct || null);
    setCollabInfo(collabContext?.collabInfos || null);
    setAffectation(collabContext?.affectation || null);
    if (ct?.date_debut) {
      const ans = differenceInYears(new Date(), parseISO(ct.date_debut));
      set("anciennete_retenue_ans", ans);
    }
  }, [collabContext]);

  // ── Auto-calcul préavis ────────────────────────────────────────────────────
  useEffect(() => {
    if (!avecPreavis || !form.date_depart || !contrat) return;
    const jours = calcPreavisLegal(contrat.code_type_contrat || "CDI", anciennete, form.preavis_categorie);
    const debut = parseISO(form.date_depart);
    set("preavis_duree_jours", jours);
    set("preavis_date_debut", format(debut, "yyyy-MM-dd"));
    set("preavis_date_fin", format(addDays(debut, jours), "yyyy-MM-dd"));
  }, [form.motif_depart, form.date_depart, form.preavis_categorie, contrat]);

  // ── Auto-calcul indemnité légale ──────────────────────────────────────────
  useEffect(() => {
    if (!avecIndemnite) return;
    const sal = parseFloat(String(form.base_calcul_salaire)) || 0;
    const ans = parseFloat(String(form.anciennete_retenue_ans)) || 0;
    const motif = form.motif_depart;
    if (sal > 0 && ans > 0) {
      const montant = calcIndemniteLegale(sal, ans, motif);
      if (motif.includes("Retraite")) set("indemnite_depart_retraite", montant);
      else set("indemnite_perte_emploi", montant);
    }
  }, [form.base_calcul_salaire, form.anciennete_retenue_ans, form.motif_depart]);

  // ── Upload document ────────────────────────────────────────────────────────
  const handleUpload = async (docKey: string, file: File) => {
    setUploadingKey(docKey);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("collaborateur_id", form.collaborateur_id);
      formData.append("type_document", docKey);
      const result = await api.post("/storage/depart-documents", formData);
      set(`${docKey}_path`, result?.path || result?.url || "");
      set(docKey, true);
      toast({ title: "Document téléchargé" });
    } catch (e: any) {
      toast({ title: "Erreur upload", description: e.message, variant: "destructive" });
    } finally {
      setUploadingKey(null);
    }
  };

  // ── Soumission ─────────────────────────────────────────────────────────────
  const onSubmit = async () => {
    if (!form.collaborateur_id || !form.date_depart || !form.motif_depart) {
      toast({ title: "Champs requis manquants", variant: "destructive" }); return;
    }
    // RG-DEP-FENETRE-01 : contrôle fenêtre dates
    if (dateDepartErreur) {
      toast({ title: "Date de départ invalide", description: dateDepartErreur, variant: "destructive" }); return;
    }
    if (dateNotifErreur) {
      toast({ title: "Date de notification invalide", description: dateNotifErreur, variant: "destructive" }); return;
    }
    if (contrat?.date_debut && form.date_depart < contrat.date_debut) {
      toast({ title: "Date invalide", description: `La date de départ doit être postérieure au début du contrat (${format(parseISO(contrat.date_debut), "dd/MM/yyyy", { locale: fr })}).`, variant: "destructive" }); return;
    }

    setSubmitting(true);
    try {
      // 1. Créer le départ
      await api.post("/db/collaborateur_departs", {
        collaborateur_id: form.collaborateur_id,
        date_depart: form.date_depart,
        motif_depart: form.motif_depart,
        commentaire: form.commentaire || null,
        reference_decision: form.reference_decision || null,
        date_notification: form.date_notification || null,
        date_entretien_prealable: form.date_entretien_prealable || null,
        decision_finale: form.decision_finale || null,
        // Préavis
        preavis_duree_jours: form.preavis_duree_jours || null,
        preavis_date_debut: form.preavis_date_debut || null,
        preavis_date_fin: form.preavis_date_fin || null,
        preavis_dispense: form.preavis_dispense,
        preavis_dispense_indemnite: form.preavis_dispense_indemnite || null,
        preavis_effectue: form.preavis_effectue,
        preavis_categorie: form.preavis_categorie || null,
        // Indemnités
        base_calcul_salaire: form.base_calcul_salaire || null,
        anciennete_retenue_ans: form.anciennete_retenue_ans || null,
        indemnite_perte_emploi: form.indemnite_perte_emploi || null,
        indemnite_depart_retraite: form.indemnite_depart_retraite || null,
        indemnite_conges_payes: form.indemnite_conges_payes || null,
        indemnite_compensatrice: form.indemnite_compensatrice || null,
        indemnite_transactionnelle: form.indemnite_transactionnelle || null,
        indemnite_anciennete: form.indemnite_anciennete || null,
        indemnite_13eme_mois: form.indemnite_13eme_mois || null,
        indemnite_total: totalIndemnites || null,
        solde_conges_jours: form.solde_conges_jours || null,
        // CNSS/AMO
        cnss_radiation_date: form.cnss_radiation_date || null,
        cnss_derniere_declaration: form.cnss_derniere_declaration || null,
        amo_cloture_date: form.amo_cloture_date || null,
        amo_attestation_delivree: form.amo_attestation_delivree,
        // Documents
        ...DOCS_LIST.reduce((acc, d) => ({
          ...acc,
          [d.key]: (form as any)[d.key],
          [`${d.key}_path`]: (form as any)[`${d.key}_path`] || null,
        }), {}),
        // Matériel
        ...MATERIEL_LIST.reduce((acc, m) => ({ ...acc, [m.key]: (form as any)[m.key] }), {}),
        acces_si_desactive: form.acces_si_desactive,
        acces_email_desactive: form.acces_email_desactive,
        acces_desactivation_date: form.acces_desactivation_date || null,
        created_by: user?.id,
        updated_by: user?.id,
      });

      // 2. Mettre à jour date_fin du contrat le plus récent (RG-DEP-CONTRAT-01)
      if (contrat?.id) {
        await api.patch(`/db/collaborateur_contrats?id=eq.${contrat.id}`, {
          date_fin: form.date_depart,
          updated_at: new Date().toISOString(),
        });
      }

      toast({
        title: isImmediate ? "Départ enregistré et traité" : "Départ planifié",
        description: isImmediate
          ? "Le collaborateur est marqué SORTI et le contrat clôturé."
          : `Départ planifié au ${format(parseISO(form.date_depart), "dd/MM/yyyy", { locale: fr })}. Contrat mis à jour.`,
      });
      onSuccess();
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Rendu ──────────────────────────────────────────────────────────────────
  const Fld = ({ label, required, children, hint }: { label: string; required?: boolean; children: React.ReactNode; hint?: string }) => (
    <div>
      <Label className="text-xs font-semibold mb-1.5 block" style={{ color: "hsl(var(--foreground))" }}>
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      {children}
      {hint && <p className="text-[10px] mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>{hint}</p>}
    </div>
  );

  const FldNum = ({ label, k, hint }: { label: string; k: string; hint?: string }) => (
    <Fld label={label} hint={hint}>
      <Input type="number" step="0.01" value={(form as any)[k]} onChange={e => set(k, e.target.value)} className="h-9 text-sm" placeholder="0.00" />
    </Fld>
  );

  const Check = ({ k, label }: { k: string; label: string }) => (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={(form as any)[k]} onChange={e => set(k, e.target.checked)}
        className="w-4 h-4 rounded accent-[hsl(var(--accent))]" />
      <span className="text-xs" style={{ color: "hsl(var(--foreground))" }}>{label}</span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "hsl(var(--background) / 0.85)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", maxHeight: "92vh" }}>

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
          <div className="flex items-center gap-2">
            <DoorOpen size={18} style={{ color: "hsl(var(--accent))" }} />
            <h2 className="text-base font-bold" style={{ color: "hsl(var(--foreground))" }}>Enregistrer un départ</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:opacity-70"
            style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
            <X size={16} />
          </button>
        </div>

        {/* ── Stepper ── */}
        <div className="flex items-center px-6 py-3 border-b flex-shrink-0 gap-1"
          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.15)" }}>
          {STEPS.map((s, idx) => (
            <React.Fragment key={s.id}>
              <button onClick={() => step > s.id && setStep(s.id)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: step === s.id ? "hsl(var(--accent))" : step > s.id ? "hsl(var(--accent) / 0.12)" : "transparent",
                  color: step === s.id ? "white" : step > s.id ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))",
                  cursor: step > s.id ? "pointer" : "default",
                }}>
                {s.icon}
                <span className="hidden sm:inline">{s.label}</span>
                {step > s.id && <Check size={10} />}
              </button>
              {idx < STEPS.length - 1 && (
                <ChevronRight size={12} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* ── Contenu ── */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* ═══════════════════════════════════════════════════
              ÉTAPE 0 — DÉPART
          ═══════════════════════════════════════════════════ */}
          {step === 0 && (
            <>
              {/* Sélection collaborateur */}
              {collaborateurId ? (
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                  style={{ background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))" }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>
                    {collabInfo?.prenom?.[0]}{collabInfo?.nom?.[0]}
                  </div>
                  <span className="text-sm font-medium">{collabInfo?.prenom} {collabInfo?.nom}</span>
                  <span className="text-xs ml-auto" style={{ color: "hsl(var(--muted-foreground))" }}>#{collabInfo?.matricule}</span>
                </div>
              ) : (
                <Fld label="Collaborateur" required>
                  <Input placeholder="Rechercher…" value={searchCollab}
                    onChange={e => {
                      setSearchCollab(e.target.value);
                      if (form.collaborateur_id) { set("collaborateur_id", ""); setSelectedCollabData(null); }
                    }}
                    className="mb-2 h-9 text-sm" />
                  {searchCollab.trim().length >= 2 && !form.collaborateur_id && (
                    <div className="max-h-44 overflow-y-auto rounded-lg border" style={{ borderColor: "hsl(var(--border))" }}>
                      {(collaborateurs as any[]).length === 0 ? (
                        <p className="text-xs text-center py-4" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun résultat</p>
                      ) : (collaborateurs as any[]).map((c: any) => (
                        <button key={c.id} type="button"
                          onClick={() => { set("collaborateur_id", c.id); setSearchCollab(`${c.prenom} ${c.nom}`); setSelectedCollabData(c); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:opacity-80 border-b last:border-0"
                          style={{ borderColor: "hsl(var(--border) / 0.4)", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }}>
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                            style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>
                            {c.prenom?.[0]}{c.nom?.[0]}
                          </div>
                          <span>{c.prenom} {c.nom}</span>
                          <span className="ml-auto text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>#{c.matricule}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {form.collaborateur_id && selectedCollab && (
                    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg mt-1"
                      style={{ background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))" }}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>
                        {(selectedCollab as any).prenom?.[0]}{(selectedCollab as any).nom?.[0]}
                      </div>
                      <span className="text-sm font-medium">{(selectedCollab as any).prenom} {(selectedCollab as any).nom}</span>
                      <span className="text-xs ml-auto" style={{ color: "hsl(var(--muted-foreground))" }}>#{(selectedCollab as any).matricule}</span>
                      <button onClick={() => { set("collaborateur_id", ""); setSearchCollab(""); setSelectedCollabData(null); }}><X size={14} /></button>
                    </div>
                  )}
                </Fld>
              )}

              {/* Pavé situation actuelle — identique à DepartsProvisoiresPage */}
              {form.collaborateur_id && (() => {
                const c = collabContext?.contrat;
                const a = collabContext?.affectation;
                const ci = collabContext?.collabInfos;
                const ti = getTypeContratInfo(c?.code_type_contrat);
                const si = getStatutInfo(c?.code_statut_contrat);

                const photoRaw = ci?.photo_path || ci?.photo_url || ci?.avatar_url || null;
                const photoUrl = photoRaw
                  ? (photoRaw.startsWith("http") || photoRaw.startsWith("/") ? photoRaw : `/api/v1/storage/${photoRaw}`)
                  : null;
                const initiales = `${ci?.prenom?.[0] || ""}${ci?.nom?.[0] || ""}`;
                const AvatarEl = ({ size = 36 }: { size?: number }) => photoUrl ? (
                  <img src={photoUrl} alt=""
                    className="rounded-full object-cover flex-shrink-0"
                    style={{ width: size, height: size, border: "1px solid hsl(var(--border))" }}
                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                ) : (
                  <div className="rounded-full flex items-center justify-center font-bold flex-shrink-0"
                    style={{ width: size, height: size, fontSize: size <= 24 ? 10 : 12, background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>
                    {initiales}
                  </div>
                );

                return (
                  <div className="rounded-xl border overflow-hidden shadow-sm"
                    style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.25)" }}>

                    {/* En-tête */}
                    <div className="px-4 py-2.5 border-b flex items-center justify-between"
                      style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.5)" }}>
                      <div className="flex items-center gap-1.5">
                        <Briefcase size={13} style={{ color: "hsl(var(--accent))" }} />
                        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--foreground))" }}>
                          Situation actuelle
                        </span>
                      </div>
                      {loadingInfo && <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>Chargement…</span>}
                    </div>

                    {/* Identité collaborateur */}
                    {ci && (
                      <div className="flex items-center gap-3 px-4 py-2.5 border-b"
                        style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
                        <AvatarEl size={36} />
                        <div>
                          <p className="text-sm font-semibold leading-tight" style={{ color: "hsl(var(--foreground))" }}>
                            {ci.civilite ? `${ci.civilite} ` : ""}{ci.nom} {ci.prenom}
                          </p>
                          <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>#{ci.matricule}</p>
                        </div>
                      </div>
                    )}

                    {!loadingInfo && (
                      <div className="grid grid-cols-2 divide-x" style={{ borderColor: "hsl(var(--border))" }}>

                        {/* ─ Contrat ─ */}
                        <div className="p-4 space-y-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Contrat</p>
                          {c ? (
                            <>
                              <div className="space-y-1">
                                <p className="text-sm font-bold leading-tight" style={{ color: ti.couleur }} title={c.code_type_contrat}>
                                  {ti.libelle}
                                </p>
                                {c.code_statut_contrat && (
                                  <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider animate-pulse"
                                    style={{ color: si.couleur }}>
                                    <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: si.couleur }} />
                                    {si.libelle}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] space-y-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                                <p>
                                  Du{" "}<span style={{ color: "hsl(var(--foreground))", fontWeight: 600 }}>
                                    {c.date_debut ? format(parseISO(c.date_debut), "dd/MM/yyyy", { locale: fr }) : "—"}
                                  </span>
                                  {c.date_fin
                                    ? <> au <span style={{ color: "hsl(var(--foreground))", fontWeight: 600 }}>{format(parseISO(c.date_fin), "dd/MM/yyyy", { locale: fr })}</span></>
                                    : <span className="ml-1 italic">(sans date de fin)</span>}
                                </p>
                                {c.reference_contrat && (
                                  <p className="text-[10px] font-mono pt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{c.reference_contrat}</p>
                                )}
                              </div>
                            </>
                          ) : (
                            <p className="text-xs italic" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun contrat actif</p>
                          )}
                        </div>

                        {/* ─ Affectation ─ */}
                        <div className="p-4 space-y-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Affectation</p>
                          {a ? (
                            <div className="space-y-2">
                              {(a.libelle_uo || a.raw?.unite_id) && (
                                <div>
                                  <div className="flex items-start gap-1.5">
                                    <Building2 size={13} style={{ color: a.couleur_uo || "hsl(var(--accent))", marginTop: 1, flexShrink: 0 }} />
                                    <p className="text-sm font-semibold leading-tight" style={{ color: a.couleur_uo || "hsl(var(--foreground))" }}>
                                      {a.libelle_uo || "Unité organisationnelle"}
                                    </p>
                                  </div>
                                  {a.date_debut_uo && (
                                    <p className="text-[11px] pl-[18px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                                      Affecté(e) le{" "}
                                      <span style={{ color: "hsl(var(--foreground))", fontWeight: 600 }}>
                                        {format(parseISO(a.date_debut_uo), "dd/MM/yyyy", { locale: fr })}
                                      </span>
                                    </p>
                                  )}
                                </div>
                              )}
                              {(a.libelle_poste || a.code_instance_poste) && (
                                <div className="pt-1 border-t" style={{ borderColor: "hsl(var(--border) / 0.5)" }}>
                                  <div className="flex items-start gap-1.5 pt-1">
                                    <UserCircle2 size={13} style={{ color: "hsl(var(--foreground))", marginTop: 1, flexShrink: 0 }} />
                                    <p className="text-xs font-medium leading-tight" style={{ color: "hsl(var(--foreground))" }}>
                                      {a.libelle_poste || a.code_poste_parent || a.code_instance_poste}
                                    </p>
                                  </div>
                                  {a.date_debut_poste && (
                                    <p className="text-[11px] pl-[18px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                                      Attribué(e) le{" "}
                                      <span style={{ color: "hsl(var(--foreground))", fontWeight: 600 }}>
                                        {format(parseISO(a.date_debut_poste), "dd/MM/yyyy", { locale: fr })}
                                      </span>
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs italic" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune affectation active</p>
                          )}
                        </div>

                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Date de départ */}
              <Fld label="Date de départ" required>
                <Input
                  type="date"
                  value={form.date_depart}
                  min={dateMinDepart}
                  max={dateMaxDepart}
                  onChange={e => set("date_depart", e.target.value)}
                  className="h-9 text-sm"
                  style={{ borderColor: dateDepartErreur ? "hsl(0 70% 50%)" : undefined }}
                />
                {/* Message d'erreur fenêtre */}
                {dateDepartErreur && (
                  <div className="mt-1.5 flex items-start gap-2 px-3 py-2 rounded-lg"
                    style={{ background: "hsl(0 70% 50% / 0.08)", border: "1px solid hsl(0 70% 50% / 0.25)" }}>
                    <AlertTriangle size={13} style={{ color: "hsl(0 70% 40%)", flexShrink: 0, marginTop: 1 }} />
                    <p className="text-xs" style={{ color: "hsl(0 70% 40%)" }}>{dateDepartErreur}</p>
                  </div>
                )}
                {/* Indicateur fenêtre autorisée */}
                {!dateDepartErreur && (
                  <p className="text-[10px] mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Fenêtre autorisée : du <strong>{format(parseISO(dateMinDepart), "dd/MM/yyyy", { locale: fr })}</strong> au <strong>{format(parseISO(dateMaxDepart), "dd/MM/yyyy", { locale: fr })}</strong>
                    <span className="ml-1 opacity-60">({fenetrePasseJ}j passé / {fenetreFuturJ}j futur)</span>
                  </p>
                )}
                {/* Indicateur RG immédiat/futur */}
                {form.date_depart && !dateDepartErreur && (
                  <div className="mt-1.5 flex items-start gap-2 px-3 py-2 rounded-lg"
                    style={{
                      background: isImmediate ? "hsl(0 70% 50% / 0.08)" : "hsl(45 100% 50% / 0.10)",
                      border: `1px solid ${isImmediate ? "hsl(0 70% 50% / 0.2)" : "hsl(45 100% 50% / 0.25)"}`,
                    }}>
                    {isImmediate
                      ? <AlertTriangle size={13} style={{ color: "hsl(0 70% 40%)", flexShrink: 0, marginTop: 1 }} />
                      : <Info size={13} style={{ color: "hsl(45 100% 35%)", flexShrink: 0, marginTop: 1 }} />}
                    <p className="text-xs" style={{ color: isImmediate ? "hsl(0 70% 40%)" : "hsl(45 100% 35%)" }}>
                      {isImmediate
                        ? "Date passée → Exécution immédiate : contrat clôturé, collaborateur marqué SORTI."
                        : "Date future → Départ planifié. La clôture sera automatique à l'échéance."}
                    </p>
                  </div>
                )}
              </Fld>

              {/* Motif */}
              <Fld label="Motif de départ" required>
                <select value={form.motif_depart} onChange={e => set("motif_depart", e.target.value)}
                  className="w-full h-9 text-sm rounded-lg border px-3"
                  style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
                  <option value="">— Sélectionner —</option>
                  {MOTIFS_DEPART.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </Fld>

              {/* Date notification + Entretien préalable (CDI licenciement) */}
              <div className="grid grid-cols-2 gap-4">
                <Fld label="Date de notification"
                  hint={form.date_depart
                    ? `Doit être ≤ date de départ (${format(parseISO(form.date_depart), "dd/MM/yyyy", { locale: fr })})`
                    : "Date de remise de la lettre au collaborateur"}>
                  <Input
                    type="date"
                    value={form.date_notification}
                    min={dateMinDepart}
                    max={form.date_depart || dateMaxDepart}
                    onChange={e => set("date_notification", e.target.value)}
                    className="h-9 text-sm"
                    style={{ borderColor: dateNotifErreur ? "hsl(0 70% 50%)" : undefined }}
                  />
                  {dateNotifErreur && (
                    <div className="mt-1 flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg"
                      style={{ background: "hsl(0 70% 50% / 0.08)", border: "1px solid hsl(0 70% 50% / 0.2)" }}>
                      <AlertTriangle size={12} style={{ color: "hsl(0 70% 40%)", flexShrink: 0, marginTop: 1 }} />
                      <p className="text-[11px]" style={{ color: "hsl(0 70% 40%)" }}>{dateNotifErreur}</p>
                    </div>
                  )}
                </Fld>
                {needsEntretien && (
                  <Fld label="Date entretien préalable" hint="Obligatoire Art.62 CT Maroc (CDI licenciement)">
                    <Input type="date" value={form.date_entretien_prealable} onChange={e => set("date_entretien_prealable", e.target.value)} className="h-9 text-sm" />
                  </Fld>
                )}
              </div>

              {/* Référence + Commentaire */}
              <Fld label="Référence de la décision">
                <Input value={form.reference_decision} onChange={e => set("reference_decision", e.target.value)} placeholder="Ex : DRH/2026/042" className="h-9 text-sm" />
              </Fld>
              <Fld label="Commentaire">
                <Textarea value={form.commentaire} onChange={e => set("commentaire", e.target.value)} placeholder="Observations, circonstances…" rows={3} className="text-sm resize-none" />
              </Fld>
            </>
          )}

          {/* ═══════════════════════════════════════════════════
              ÉTAPE 1 — PRÉAVIS
          ═══════════════════════════════════════════════════ */}
          {step === 1 && (
            <>
              {!avecPreavis && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl"
                  style={{ background: "hsl(142 55% 45% / 0.1)", border: "1px solid hsl(142 55% 45% / 0.25)", color: "hsl(142 55% 28%)" }}>
                  <Info size={14} />
                  <p className="text-xs font-medium">
                    {contrat?.code_type_contrat === "CDD"
                      ? "CDD : pas de préavis légal selon le Code du Travail marocain (sauf clause contractuelle)."
                      : `Le motif "${form.motif_depart}" ne génère pas de préavis légal.`}
                  </p>
                </div>
              )}

              {/* Catégorie pour calcul préavis */}
              <Fld label="Catégorie professionnelle" hint="Détermine la durée légale du préavis (Art.43 CT)">
                <select value={form.preavis_categorie} onChange={e => set("preavis_categorie", e.target.value)}
                  className="w-full h-9 text-sm rounded-lg border px-3"
                  style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
                  <option value="EXECUTION">Exécution</option>
                  <option value="MAITRISE">Maîtrise</option>
                  <option value="CADRE">Cadre</option>
                </select>
              </Fld>

              <div className="grid grid-cols-2 gap-4">
                <Fld label="Durée préavis (jours)" hint="Calculé automatiquement selon ancienneté et catégorie">
                  <Input type="number" value={form.preavis_duree_jours} onChange={e => set("preavis_duree_jours", e.target.value)} className="h-9 text-sm" />
                </Fld>
                <div className="flex flex-col justify-end">
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Légal calculé (Art.43 CT)
                  </p>
                  <div className="px-3 py-2 rounded-lg text-sm font-bold"
                    style={{ background: "hsl(var(--accent) / 0.1)", color: "hsl(var(--accent))" }}>
                    {avecPreavis && contrat
                      ? `${calcPreavisLegal(contrat.code_type_contrat || "CDI", anciennete, form.preavis_categorie)} jours`
                      : "—"}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Fld label="Date début préavis">
                  <Input type="date" value={form.preavis_date_debut} onChange={e => set("preavis_date_debut", e.target.value)} className="h-9 text-sm" />
                </Fld>
                <Fld label="Date fin préavis">
                  <Input type="date" value={form.preavis_date_fin} onChange={e => set("preavis_date_fin", e.target.value)} className="h-9 text-sm" />
                </Fld>
              </div>

              <div className="space-y-3 p-4 rounded-xl border" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.15)" }}>
                <p className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>Options préavis</p>
                <Check k="preavis_dispense" label="Dispense de préavis (collaborateur libéré immédiatement)" />
                <Check k="preavis_effectue" label="Préavis effectué intégralement" />
              </div>

              {form.preavis_dispense && (
                <FldNum label="Indemnité compensatrice de préavis (MAD)"
                  k="preavis_dispense_indemnite"
                  hint="Versée si dispense de préavis à l'initiative de l'employeur" />
              )}
            </>
          )}

          {/* ═══════════════════════════════════════════════════
              ÉTAPE 2 — INDEMNITÉS
          ═══════════════════════════════════════════════════ */}
          {step === 2 && (
            <>
              {/* Base de calcul */}
              <div className="p-4 rounded-xl border space-y-4" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.15)" }}>
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "hsl(var(--foreground))" }}>Base de calcul</p>
                <div className="grid grid-cols-2 gap-4">
                  <FldNum label="Salaire mensuel brut (MAD)"
                    k="base_calcul_salaire"
                    hint="Moyenne 3 derniers mois (base Art.53 CT)" />
                  <Fld label="Ancienneté retenue (ans)" hint={`Calculée automatiquement : ${anciennete} an(s)`}>
                    <Input type="number" step="0.5" value={form.anciennete_retenue_ans}
                      onChange={e => set("anciennete_retenue_ans", e.target.value)} className="h-9 text-sm" />
                  </Fld>
                </div>
              </div>

              {/* Indemnités légales */}
              <div className="p-4 rounded-xl border space-y-4" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.15)" }}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "hsl(var(--foreground))" }}>Indemnités légales</p>
                  <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--accent)/0.1)", color: "hsl(var(--accent))" }}>
                    Art.52-53 CT Maroc
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FldNum label="Indemnité de perte d'emploi (MAD)" k="indemnite_perte_emploi" hint="96h de salaire / année ancienneté (licenciement)" />
                  <FldNum label="Indemnité de départ retraite (MAD)" k="indemnite_depart_retraite" hint="96h de salaire / année ancienneté (retraite)" />
                  <FldNum label="Indemnité de congés payés (MAD)" k="indemnite_conges_payes" hint="Solde congés non pris" />
                  <Fld label="Solde congés (jours)">
                    <Input type="number" step="0.5" value={form.solde_conges_jours} onChange={e => set("solde_conges_jours", e.target.value)} className="h-9 text-sm" />
                  </Fld>
                </div>
              </div>

              {/* Autres indemnités */}
              <div className="p-4 rounded-xl border space-y-4" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.15)" }}>
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "hsl(var(--foreground))" }}>Autres indemnités</p>
                <div className="grid grid-cols-2 gap-4">
                  <FldNum label="Indemnité compensatrice (MAD)" k="indemnite_compensatrice" />
                  <FldNum label="Indemnité transactionnelle (MAD)" k="indemnite_transactionnelle" hint="Accord amiable / rupture conventionnelle" />
                  <FldNum label="Prime ancienneté proratisée (MAD)" k="indemnite_anciennete" />
                  <FldNum label="Prorata 13ème mois (MAD)" k="indemnite_13eme_mois" hint="Si prévu au contrat ou à la convention" />
                </div>
              </div>

              {/* Total */}
              <div className="flex items-center justify-between px-4 py-3 rounded-xl"
                style={{ background: "hsl(var(--accent) / 0.1)", border: "1px solid hsl(var(--accent) / 0.25)" }}>
                <span className="text-sm font-bold" style={{ color: "hsl(var(--foreground))" }}>TOTAL INDEMNITÉS</span>
                <span className="text-lg font-bold" style={{ color: "hsl(var(--accent))" }}>
                  {totalIndemnites.toLocaleString("fr-MA", { minimumFractionDigits: 2 })} MAD
                </span>
              </div>
            </>
          )}

          {/* ═══════════════════════════════════════════════════
              ÉTAPE 3 — ADMINISTRATIF (CNSS/AMO + Matériel)
          ═══════════════════════════════════════════════════ */}
          {step === 3 && (
            <>
              {/* CNSS / AMO */}
              <div className="p-4 rounded-xl border space-y-4" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.15)" }}>
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "hsl(var(--foreground))" }}>CNSS / AMO</p>
                <div className="grid grid-cols-2 gap-4">
                  <Fld label="Date radiation CNSS">
                    <Input type="date" value={form.cnss_radiation_date} onChange={e => set("cnss_radiation_date", e.target.value)} className="h-9 text-sm" />
                  </Fld>
                  <Fld label="Dernière déclaration CNSS">
                    <Input type="date" value={form.cnss_derniere_declaration} onChange={e => set("cnss_derniere_declaration", e.target.value)} className="h-9 text-sm" />
                  </Fld>
                  <Fld label="Date clôture AMO">
                    <Input type="date" value={form.amo_cloture_date} onChange={e => set("amo_cloture_date", e.target.value)} className="h-9 text-sm" />
                  </Fld>
                  <div className="flex items-end pb-1">
                    <Check k="amo_attestation_delivree" label="Attestation AMO délivrée" />
                  </div>
                </div>
              </div>

              {/* Restitution matériel */}
              <div className="p-4 rounded-xl border space-y-3" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.15)" }}>
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "hsl(var(--foreground))" }}>Restitution matériel</p>
                <div className="grid grid-cols-2 gap-2">
                  {MATERIEL_LIST.map(m => <Check key={m.key} k={m.key} label={m.label} />)}
                </div>
              </div>

              {/* Accès SI */}
              <div className="p-4 rounded-xl border space-y-3" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.15)" }}>
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "hsl(var(--foreground))" }}>Désactivation accès</p>
                <div className="grid grid-cols-2 gap-3">
                  <Check k="acces_si_desactive" label="Accès SI désactivé" />
                  <Check k="acces_email_desactive" label="Messagerie désactivée" />
                </div>
                <Fld label="Date désactivation accès">
                  <Input type="date" value={form.acces_desactivation_date} onChange={e => set("acces_desactivation_date", e.target.value)} className="h-9 text-sm" />
                </Fld>
              </div>

              {/* Décision finale */}
              <Fld label="Décision finale">
                <select value={form.decision_finale} onChange={e => set("decision_finale", e.target.value)}
                  className="w-full h-9 text-sm rounded-lg border px-3"
                  style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
                  <option value="ACCEPTE">Accepté</option>
                  <option value="REFUSE">Refusé</option>
                  <option value="SANS_REPONSE">Sans réponse</option>
                  <option value="EN_COURS">En cours</option>
                </select>
              </Fld>
            </>
          )}

          {/* ═══════════════════════════════════════════════════
              ÉTAPE 4 — DOCUMENTS
          ═══════════════════════════════════════════════════ */}
          {step === 4 && (
            <div className="space-y-3">
              <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                Cochez les documents remis et/ou téléchargez les fichiers scannés.
              </p>
              {DOCS_LIST.map(doc => (
                <div key={doc.key} className="flex items-center gap-3 px-4 py-3 rounded-xl border"
                  style={{ borderColor: (form as any)[doc.key] ? "hsl(142 55% 45% / 0.4)" : "hsl(var(--border))", background: (form as any)[doc.key] ? "hsl(142 55% 45% / 0.06)" : "hsl(var(--muted) / 0.15)" }}>
                  {/* Checkbox remis */}
                  <input type="checkbox" checked={(form as any)[doc.key]} onChange={e => set(doc.key, e.target.checked)}
                    className="w-4 h-4 rounded flex-shrink-0 accent-[hsl(142_55%_45%)]" />
                  <span className="text-xs font-medium flex-1" style={{ color: "hsl(var(--foreground))" }}>{doc.label}</span>
                  {/* Bouton upload */}
                  <label className="flex items-center gap-1.5 cursor-pointer px-2.5 py-1 rounded-lg text-[11px] font-medium transition-opacity hover:opacity-70"
                    style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                      onChange={e => { if (e.target.files?.[0]) handleUpload(doc.key, e.target.files[0]); }} />
                    {uploadingKey === doc.key ? "…" : <><Upload size={11} /> Upload</>}
                  </label>
                  {/* Indicateur fichier uploadé */}
                  {(form as any)[`${doc.key}_path`] && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full"
                      style={{ background: "hsl(142 55% 45% / 0.12)", color: "hsl(142 55% 28%)" }}>
                      ✓ Fichier joint
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════
              ÉTAPE 5 — RÉCAPITULATIF
          ═══════════════════════════════════════════════════ */}
          {step === 5 && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl border"
                style={{ borderColor: "hsl(var(--accent)/0.3)", background: "hsl(var(--accent)/0.05)" }}>
                <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "hsl(var(--accent))" }}>Résumé du départ</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Collaborateur", value: `${selectedCollab?.prenom || collabInfo?.prenom || ""} ${selectedCollab?.nom || collabInfo?.nom || ""}` },
                    { label: "Date de départ", value: form.date_depart ? format(parseISO(form.date_depart), "dd MMMM yyyy", { locale: fr }) : "—" },
                    { label: "Motif", value: form.motif_depart || "—" },
                    { label: "Statut", value: isImmediate ? "Départ immédiat" : "Départ planifié" },
                    { label: "Référence", value: form.reference_decision || "—" },
                    { label: "Décision finale", value: form.decision_finale || "—" },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</p>
                      <p className="text-xs font-medium" style={{ color: "hsl(var(--foreground))" }}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {avecPreavis && form.preavis_duree_jours && (
                <div className="p-4 rounded-xl border space-y-1.5" style={{ borderColor: "hsl(var(--border))" }}>
                  <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "hsl(var(--foreground))" }}>Préavis</p>
                  <div className="flex justify-between text-xs">
                    <span style={{ color: "hsl(var(--muted-foreground))" }}>Durée</span>
                    <span style={{ color: "hsl(var(--foreground))" }}>{form.preavis_duree_jours} jours</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span style={{ color: "hsl(var(--muted-foreground))" }}>Statut</span>
                    <span style={{ color: "hsl(var(--foreground))" }}>{form.preavis_dispense ? "Dispensé" : form.preavis_effectue ? "Effectué" : "Non effectué"}</span>
                  </div>
                  {form.preavis_date_debut && form.preavis_date_fin && (
                    <div className="flex justify-between text-xs">
                      <span style={{ color: "hsl(var(--muted-foreground))" }}>Période</span>
                      <span style={{ color: "hsl(var(--foreground))" }}>
                        {format(parseISO(form.preavis_date_debut), "dd/MM/yyyy")} → {format(parseISO(form.preavis_date_fin), "dd/MM/yyyy")}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {totalIndemnites > 0 && (
                <div className="p-4 rounded-xl border" style={{ borderColor: "hsl(var(--border))" }}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "hsl(var(--foreground))" }}>Indemnités</p>
                    <span className="text-base font-bold" style={{ color: "hsl(var(--accent))" }}>
                      {totalIndemnites.toLocaleString("fr-MA", { minimumFractionDigits: 2 })} MAD
                    </span>
                  </div>
                  <div className="space-y-1">
                    {([
                      { k: "indemnite_perte_emploi",     label: "Perte d'emploi" },
                      { k: "indemnite_depart_retraite",  label: "Départ retraite" },
                      { k: "indemnite_conges_payes",     label: "Congés payés" },
                      { k: "indemnite_compensatrice",    label: "Compensatrice préavis" },
                      { k: "indemnite_transactionnelle", label: "Transactionnelle" },
                      { k: "indemnite_anciennete",       label: "Ancienneté" },
                      { k: "indemnite_13eme_mois",       label: "13ème mois" },
                    ] as const).filter(i => parseFloat(String((form as any)[i.k])) > 0).map(i => (
                      <div key={i.k} className="flex justify-between text-xs">
                        <span style={{ color: "hsl(var(--muted-foreground))" }}>{i.label}</span>
                        <span style={{ color: "hsl(var(--foreground))" }}>
                          {parseFloat(String((form as any)[i.k])).toLocaleString("fr-MA", { minimumFractionDigits: 2 })} MAD
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Docs et matériel */}
              <div className="p-4 rounded-xl border" style={{ borderColor: "hsl(var(--border))" }}>
                <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "hsl(var(--foreground))" }}>Documents & Matériel</p>
                <div className="flex flex-wrap gap-1.5">
                  {DOCS_LIST.filter(d => (form as any)[d.key]).map(d => (
                    <span key={d.key} className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                      style={{ background: "hsl(142 55% 45% / 0.12)", color: "hsl(142 55% 28%)", border: "1px solid hsl(142 55% 45% / 0.25)" }}>
                      ✓ {d.label}
                    </span>
                  ))}
                  {MATERIEL_LIST.filter(m => (form as any)[m.key]).map(m => (
                    <span key={m.key} className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                      style={{ background: "hsl(210 70% 50% / 0.1)", color: "hsl(210 70% 35%)", border: "1px solid hsl(210 70% 50% / 0.2)" }}>
                      ✓ {m.label}
                    </span>
                  ))}
                  {DOCS_LIST.filter(d => !(form as any)[d.key]).length === DOCS_LIST.length && (
                    <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun document coché</span>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-2 p-3 rounded-xl"
                style={{ background: isImmediate ? "hsl(0 70% 50% / 0.07)" : "hsl(38 92% 50% / 0.07)", border: `1px solid ${isImmediate ? "hsl(0 70% 50% / 0.2)" : "hsl(38 92% 50% / 0.2)"}` }}>
                <AlertTriangle size={13} style={{ color: isImmediate ? "hsl(0 70% 45%)" : "hsl(38 92% 40%)", marginTop: 1, flexShrink: 0 }} />
                <p className="text-xs leading-relaxed" style={{ color: isImmediate ? "hsl(0 70% 40%)" : "hsl(38 92% 35%)" }}>
                  {isImmediate
                    ? "Ce départ est immédiat. Le collaborateur sera marqué SORTI et le contrat sera clôturé à la validation."
                    : `Ce départ est planifié au ${form.date_depart ? format(parseISO(form.date_depart), "dd/MM/yyyy", { locale: fr }) : "—"}. Le collaborateur restera ACTIF jusqu'à la date de départ.`}
                </p>
              </div>
            </div>
          )}

        </div>

        {/* ── Footer navigation ── */}
        <div className="flex items-center justify-between px-6 py-4 border-t flex-shrink-0"
          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.2)" }}>
          <Button type="button" variant="outline" onClick={() => step > 0 ? setStep(s => s - 1) : onClose()}
            className="flex items-center gap-2">
            <ChevronLeft size={14} />
            {step === 0 ? "Annuler" : "Précédent"}
          </Button>
          <div className="flex items-center gap-1">
            {STEPS.map(s => (
              <div key={s.id} className="w-1.5 h-1.5 rounded-full transition-all"
                style={{ background: step === s.id ? "hsl(var(--accent))" : step > s.id ? "hsl(var(--accent) / 0.4)" : "hsl(var(--muted-foreground) / 0.3)" }} />
            ))}
          </div>
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={() => {
              if (step === 0 && (!form.collaborateur_id || !form.date_depart || !form.motif_depart)) {
                toast({ title: "Veuillez remplir les champs obligatoires", variant: "destructive" }); return;
              }
              if (step === 0 && dateDepartErreur) {
                toast({ title: "Date de départ invalide", description: dateDepartErreur, variant: "destructive" }); return;
              }
              setStep(s => s + 1);
            }} className="flex items-center gap-2"
              style={{ background: "hsl(var(--accent))", color: "white" }}>
              Suivant <ChevronRight size={14} />
            </Button>
          ) : (
            <Button type="button" onClick={onSubmit} disabled={submitting}
              style={{ background: isImmediate ? "hsl(0 70% 45%)" : "hsl(var(--accent))", color: "white" }}>
              {submitting ? "Enregistrement…" : isImmediate ? "Confirmer le départ" : "Planifier le départ"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default DepartForm;
