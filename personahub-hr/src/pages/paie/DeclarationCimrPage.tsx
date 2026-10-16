/**
 * DeclarationCimrPage – Déclaration CIMR trimestrielle en 4 étapes
 * RG-DECL-CIMR-01 : Alimentation automatique (trimestre = agrégation de 3 mois de bulletins)
 * RG-DECL-CIMR-02 : Résolution taux + catégorie (déjà choisis sur collaborateur_regime,
 *                    la tranche haute étant calculée ici, jamais stockée en base)
 * RG-DECL-CIMR-03 : Contrôle de cohérence (matricule CIMR, catégorie, taux, adhérent société…)
 * RG-DECL-CIMR-04 : Génération du fichier texte ASCII 160 positions (nom.TXT)
 *
 * ⚠ HYPOTHÈSE À CONFIRMER (RG-DECL-CIMR-ENCODAGE) : le guide CIMR ne précise pas
 * explicitement l'unité du champ 14 (salaire soumis). Ce fichier l'exprime en
 * CENTIMES (convention courante des bordereaux sociaux marocains), voir
 * SALAIRE_EN_CENTIMES ci-dessous. À valider avec la CIMR / un bordereau de
 * référence avant toute télédéclaration réelle.
 */
import React, { useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { StatutBadge, StatutSelector, type CodeStatutDeclaration } from "@/components/paie/StatutDeclaration";
import {
  Shield, FileText, CheckCircle2, AlertTriangle, Download,
  Loader2, ArrowRight, ArrowLeft, Users, RefreshCw, Search, Settings, Info, Eye, X, Wallet, Building2
} from "lucide-react";

const SALAIRE_EN_CENTIMES = true; // ⚠ voir en-tête du fichier — à confirmer

const TRIMESTRE_LABELS = ["", "1er trimestre", "2e trimestre", "3e trimestre", "4e trimestre"];

interface DeclarationCimrLigne {
  id?: string;
  collaborateur_id?: string;
  code_enregistrement: 2 | 7;
  matricule: string;              // interne (champ 7, facultatif)
  cin: string;
  num_cnss: string;
  gsm: string;
  email: string;
  num_cimr: string;               // matricule CIMR (champ 4)
  nom: string;
  prenom: string;
  code_genre: string;             // 'H' | 'F' (base)
  code_nationalite: string;       // 'MAR' | autre (base)
  date_naissance: string;
  date_affiliation: string;
  code_situation_familiale: string;
  nb_enfants: number | null;
  salaire_soumis: number;         // en DH, converti en centimes à la génération si besoin
  date_sortie: string;
  code_variante_regime: string;
  code_categorie_base: number | null;
  taux_cotisation: number | null; // taux salarial choisi (ex. 6.00)
  statut_salarie: string;         // ACTIF | SORTANT
  observations: string;
  est_valide: boolean;
  erreurs?: string[];
}

interface DeclarationCimr {
  id?: string;
  trimestre: number;
  annee: number;
  statut: string;
  nombre_lignes: number;
  total_salaires: number;
  numero_adherent?: string | null;
  fichier_txt_path?: string | null;
  created_at?: string;
}

// ─── Référentiel des variantes de catégorie (chargé une fois, filtré CIMR) ───
interface VarianteCimr {
  code_variante: string; libelle: string; borne_min: number; borne_max: number;
  gere_tranche: boolean; offset_tranche2: number | null; seuil_tranche: number | null;
}

// ─── Résolution du numéro de catégorie déclaré (champ 3) ─────────────────
// Tranche basse = code_categorie_base ; tranche haute = code_categorie_base + offset,
// jamais stockée séparément, recalculée à chaque génération selon le salaire du trimestre.
function resoudreNumeroCategorie(variante: VarianteCimr | undefined, base: number | null, salaireSoumis: number): number | null {
  if (base === null || base === undefined || !variante) return null;
  if (!variante.gere_tranche) return base;
  const seuil = variante.seuil_tranche ?? 18000;
  return salaireSoumis > seuil ? base + (variante.offset_tranche2 ?? 0) : base;
}

// ─── Formatage largeur fixe (mêmes règles que le guide : N cadré droite/zéros, A/AN cadré gauche/espaces) ───
const fmtN = (val: number | string | null | undefined, len: number): string => {
  const digits = String(val ?? "").replace(/[^\d]/g, "");
  return digits.padStart(len, "0").slice(-len);
};
const fmtA = (val: string | null | undefined, len: number): string => {
  const s = (val ?? "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return s.padEnd(len, " ").slice(0, len);
};
const fmtDateN = (val: string | null | undefined): string => {
  if (!val) return "".padStart(8, "0");
  const d = new Date(val);
  if (isNaN(d.getTime())) return "".padStart(8, "0");
  const jj = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const aaaa = String(d.getFullYear());
  return `${jj}${mm}${aaaa}`;
};
const sexeDeclare = (codeGenre: string | null | undefined) => (codeGenre === "F" ? "F" : "M"); // H → M, F → F
const nationaliteDeclaree = (codeNationalite: string | null | undefined) => (codeNationalite === "MAR" ? "M" : "A");

// GSM guide CIMR : "002126********" (Maroc) ou "00**6********" (étranger), 14 positions N.
// Convertit +212XXXXXXXXX ou 0XXXXXXXXX (local) vers ce format.
const fmtGsm = (val: string | null | undefined): string => {
  if (!val) return "".padStart(14, "0");
  let s = val.trim();
  if (s.startsWith("+")) s = "00" + s.slice(1);
  else if (s.startsWith("0") && s.replace(/\D/g, "").length <= 10) s = "00212" + s.slice(1); // 0XXXXXXXXX (local MA) → 00212XXXXXXXXX
  const digits = s.replace(/[^\d]/g, "");
  return digits.padStart(14, "0").slice(-14);
};

// ─── Construction des 21 champs exacts (aperçu + génération, même source) ───
interface ChampApercu { position: number; libelle: string; longueur: number; type: "N" | "A" | "AN"; valeur: string; }

function construireChamps(
  l: DeclarationCimrLigne, numeroAdherent: string, trimestre: number, annee: number, variantesCimr: VarianteCimr[]
): ChampApercu[] {
  const variante = variantesCimr.find(v => v.code_variante === l.code_variante_regime);
  const numeroCategorie = resoudreNumeroCategorie(variante, l.code_categorie_base, l.salaire_soumis) ?? 0;
  const salaireDeclare = SALAIRE_EN_CENTIMES ? Math.round(l.salaire_soumis * 100) : Math.round(l.salaire_soumis);

  return [
    { position: 1, libelle: "Code enregistrement", longueur: 1, type: "N", valeur: fmtN(l.code_enregistrement, 1) },
    { position: 2, libelle: "Numéro d'adhérent", longueur: 6, type: "N", valeur: fmtN(numeroAdherent, 6) },
    { position: 3, libelle: "Numéro de catégorie", longueur: 2, type: "N", valeur: fmtN(numeroCategorie, 2) },
    { position: 4, libelle: "Matricule CIMR", longueur: 9, type: "N", valeur: fmtN(l.num_cimr, 9) },
    { position: 5, libelle: "Taux de cotisation", longueur: 4, type: "N", valeur: fmtN(Math.round((l.taux_cotisation ?? 0) * 100), 4) },
    { position: 6, libelle: "Nom et prénom", longueur: 20, type: "A", valeur: fmtA(`${l.nom} ${l.prenom}`, 20) },
    { position: 7, libelle: "Numéro intérieur société", longueur: 6, type: "AN", valeur: fmtA(l.matricule, 6) },
    { position: 8, libelle: "Sexe", longueur: 1, type: "A", valeur: fmtA(sexeDeclare(l.code_genre), 1) },
    { position: 9, libelle: "Nationalité", longueur: 1, type: "A", valeur: fmtA(nationaliteDeclaree(l.code_nationalite), 1) },
    { position: 10, libelle: "Date d'affiliation", longueur: 8, type: "N", valeur: fmtDateN(l.date_affiliation) },
    { position: 11, libelle: "Date de naissance", longueur: 8, type: "N", valeur: fmtDateN(l.date_naissance) },
    { position: 12, libelle: "Situation de famille", longueur: 1, type: "A", valeur: fmtA(l.code_situation_familiale, 1) },
    { position: 13, libelle: "Nombre d'enfants", longueur: 1, type: "N", valeur: fmtN(l.nb_enfants ?? 0, 1) },
    { position: 14, libelle: `Salaire soumis${SALAIRE_EN_CENTIMES ? " (centimes)" : ""}`, longueur: 10, type: "N", valeur: fmtN(salaireDeclare, 10) },
    { position: 15, libelle: "Date de sortie", longueur: 8, type: "N", valeur: l.code_enregistrement === 7 ? fmtDateN(l.date_sortie) : "".padStart(8, "0") },
    { position: 16, libelle: "N° CNIE", longueur: 10, type: "AN", valeur: fmtA(l.cin, 10) },
    { position: 17, libelle: "Matricule CNSS", longueur: 10, type: "N", valeur: fmtN(l.num_cnss, 10) },
    { position: 18, libelle: "Numéro GSM", longueur: 14, type: "N", valeur: fmtGsm(l.gsm) },
    { position: 19, libelle: "Adresse email", longueur: 35, type: "AN", valeur: fmtA(l.email, 35) },
    { position: 20, libelle: "Trimestre", longueur: 1, type: "N", valeur: fmtN(trimestre, 1) },
    { position: 21, libelle: "Année", longueur: 4, type: "N", valeur: fmtN(annee, 4) },
  ];
}

const DeclarationCimrPage: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<"wizard" | "historique">("wizard");
  const [historique, setHistorique] = useState<DeclarationCimr[]>([]);
  const [historiqueLoading, setHistoriqueLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [trimestre, setTrimestre] = useState(Math.ceil((new Date().getMonth() + 1) / 3));
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [declaration, setDeclaration] = useState<DeclarationCimr | null>(null);
  const [lignes, setLignes] = useState<DeclarationCimrLigne[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatut, setFilterStatut] = useState("TOUS");
  const [societeInfo, setSocieteInfo] = useState<{ raisonSociale: string; numeroAdherentCimr: string } | null>(null);
  const [variantesCimr, setVariantesCimr] = useState<VarianteCimr[]>([]);
  const [ligneDetail, setLigneDetail] = useState<DeclarationCimrLigne | null>(null);
  const [consultation, setConsultation] = useState<{ declaration: DeclarationCimr; lignes: any[] } | null>(null);
  const [consultationSearch, setConsultationSearch] = useState("");
  const [consultationFilter, setConsultationFilter] = useState("TOUS");
  const [consultationLoading, setConsultationLoading] = useState(false);

  // RG-DECL-CIMR-PARAM : rubrique source du salaire soumis, depuis ref_constante_paie
  // (par défaut ASSIETTE_CIMR — déjà en place dans le référentiel, mais réglable
  // sans toucher au code si la convention change un jour).
  const [rubriqueSalaireSoumis, setRubriqueSalaireSoumis] = useState("ASSIETTE_CIMR");
  const [rubriquesDisponibles, setRubriquesDisponibles] = useState<{ code: string; libelle: string }[]>([]);
  const [paramsLoaded, setParamsLoaded] = useState(false);

  // ─── Chargement société + numéro d'adhérent CIMR ───────────────────────
  useEffect(() => {
    const loadSocieteInfo = async () => {
      try {
        const { data: societes } = await supabase.from("societes" as never)
          .select("id, raison_sociale" as never).limit(1);
        const societe = (societes as any[])?.[0];
        if (!societe) return;
        const { data: affiliations } = await supabase.from("societe_affiliations" as never)
          .select("*" as never).eq("societe_id" as never, societe.id as never);
        const affCimr = ((affiliations as any[]) || []).find((a: any) => a.code_type_affiliation === "CIMR");
        setSocieteInfo({
          raisonSociale: societe.raison_sociale || "",
          numeroAdherentCimr: affCimr?.numero_affiliation || "",
        });
      } catch { /* silencieux : le contrôle signalera l'absence au bon moment */ }
    };
    loadSocieteInfo();
  }, []);

  // ─── Chargement des paramètres (rubrique source) + référentiel de rubriques + variantes ───
  useEffect(() => {
    const loadParams = async () => {
      const [{ data: rubriques }, { data: constantes }, { data: variantes }] = await Promise.all([
        supabase.from("rubrique_paie" as never)
          .select("code,libelle" as never)
          .eq("archive" as never, false as never)
          .eq("code_type" as never, "ASS" as never),
        supabase.from("ref_constante_paie" as never)
          .select("code,valeur" as never)
          .eq("code" as never, "CIMR_RUBRIQUE_SALAIRE_SOUMIS" as never),
        supabase.from("ref_categorie_regime" as never)
          .select("code_variante,libelle,borne_min,borne_max,gere_tranche,offset_tranche2,seuil_tranche" as never)
          .eq("code_regime" as never, "CIMR" as never)
          .eq("actif" as never, true as never)
          .order("ordre" as never),
      ]);
      setRubriquesDisponibles(((rubriques as any[]) || []).map(r => ({ code: r.code, libelle: r.libelle })));
      const constante = ((constantes as any[]) || [])[0];
      if (constante?.valeur) setRubriqueSalaireSoumis(constante.valeur);
      setVariantesCimr(((variantes as any[]) || []) as VarianteCimr[]);
      setParamsLoaded(true);
    };
    loadParams();
  }, []);

  const sauvegarderRubriqueSource = async (code: string) => {
    setRubriqueSalaireSoumis(code);
    const { data: existing } = await supabase.from("ref_constante_paie" as never)
      .select("id" as never).eq("code" as never, "CIMR_RUBRIQUE_SALAIRE_SOUMIS" as never);
    if ((existing as any[])?.length) {
      await supabase.from("ref_constante_paie" as never)
        .update({ valeur: code } as never).eq("code" as never, "CIMR_RUBRIQUE_SALAIRE_SOUMIS" as never);
    } else {
      await supabase.from("ref_constante_paie" as never).insert({
        code: "CIMR_RUBRIQUE_SALAIRE_SOUMIS", libelle: "Rubrique source du salaire soumis CIMR",
        valeur: code, code_type: "TEXTE",
      } as never);
    }
    toast.success("Rubrique source enregistrée");
  };

  // ─── Historique ─────────────────────────────────────────────────────────
  const loadHistorique = async () => {
    setHistoriqueLoading(true);
    try {
      const { data, error } = await supabase.from("cimr_declarations" as never)
        .select("*" as never).order("annee" as never, { ascending: false } as never);
      if (error) throw error;
      setHistorique((data || []) as DeclarationCimr[]);
    } catch (e: any) {
      toast.error(e.message);
    }
    setHistoriqueLoading(false);
  };
  useEffect(() => { if (viewMode === "historique") loadHistorique(); }, [viewMode]);

  // ─── Arrivée depuis le tableau de bord "Vue déclarations" avec une cible ───
  // précise à consulter (RG-DECL-CIMR-CONSULT) : bascule sur l'historique et
  // ouvre directement le panneau de consultation en lecture seule.
  useEffect(() => {
    const cibleId = (location.state as { consulterDeclarationId?: string } | null)?.consulterDeclarationId;
    if (!cibleId) return;
    setViewMode("historique");
    (async () => {
      const { data, error } = await supabase.from("cimr_declarations" as never)
        .select("*" as never).eq("id" as never, cibleId as never).single();
      if (!error && data) await ouvrirConsultation(data as any as DeclarationCimr);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Consultation en lecture seule (Traité/Archivé) ─────────────────────
  // RG-DECL-CIMR-CONSULT : une fois transmise et traitée (ou archivée), une
  // déclaration ne doit plus jamais être ré-alimentée/modifiée — on affiche
  // exactement les lignes telles qu'elles ont été enregistrées, sans repasser
  // par le wizard d'édition.
  const ouvrirConsultation = async (d: DeclarationCimr) => {
    setConsultationLoading(true);
    const { data, error } = await supabase.from("cimr_declaration_lignes" as never)
      .select("*" as never).eq("declaration_id" as never, d.id as never)
      .order("nom_prenom" as never);
    if (error) { toast.error(error.message); setConsultationLoading(false); return; }
    setConsultation({ declaration: d, lignes: (data as any[]) || [] });
    setConsultationSearch("");
    setConsultationFilter("TOUS");
    setConsultationLoading(false);
  };
  const estVerrouillee = (statut: string) => statut === "TRAITEE" || statut === "ARCHIVEE";
  const changerStatut = async (declId: string, nouveauStatut: CodeStatutDeclaration) => {
    const { error } = await supabase.from("cimr_declarations" as never)
      .update({ statut: nouveauStatut } as never).eq("id" as never, declId as never);
    if (error) { toast.error(error.message); return; }
    setHistorique(prev => prev.map(d => d.id === declId ? { ...d, statut: nouveauStatut } : d));
    toast.success(`Statut mis à jour : ${nouveauStatut}`);
  };

  // ─── Étape 1 : Alimentation automatique (agrégation des 3 mois du trimestre) ───
  const alimenterAuto = async () => {
    if (!paramsLoaded) { toast.error("Paramètres non chargés"); return; }
    setLoading(true);
    try {
      const moisDuTrimestre = [3 * trimestre - 2, 3 * trimestre - 1, 3 * trimestre];
      const periodeDebut = new Date(annee, moisDuTrimestre[0] - 1, 1);
      const periodeFin = new Date(annee, moisDuTrimestre[2], 0);

      // 1) Collaborateurs affectés au régime CIMR (source unique : collaborateur_regime),
      //    RG-DECL-CIMR-PERIODE : uniquement les affiliations qui COUVRENT le trimestre
      //    (date_affiliation ≤ fin de trimestre, et pas radiées avant le début du trimestre)
      const { data: affectationsCimr, error: errAff } = await supabase
        .from("collaborateur_regime" as never)
        .select("collaborateur_id,matricule_organisme,date_affiliation,date_radiation,actif,valeur_bareme_taux,code_variante_regime,code_categorie_base" as never)
        .eq("code_regime" as never, "CIMR" as never)
        .eq("actif" as never, true as never);
      if (errAff) throw errAff;
      const affectationsBrutes = (affectationsCimr as any[]) || [];
      const affectations = affectationsBrutes.filter(a => {
        if (!a.date_affiliation) return false; // pas d'affiliation datée = pas déclarable
        if (new Date(a.date_affiliation) > periodeFin) return false; // affilié après le trimestre
        if (a.date_radiation && new Date(a.date_radiation) < periodeDebut) return false; // radié avant le trimestre
        return true;
      });
      const collabIds = affectations.map(a => a.collaborateur_id);

      if (collabIds.length === 0) {
        toast.warning(`Aucun collaborateur affilié CIMR sur ${TRIMESTRE_LABELS[trimestre]} ${annee} (vérifier dates d'affiliation/radiation)`);
        setLignes([]);
        setLoading(false);
        return;
      }

      // 2) Identité + statut
      const { data: collabsRaw } = await supabase.from("collaborateurs")
        .select("id, matricule, nom, prenom, cin, num_cnss, code_genre, code_nationalite, date_naissance, code_situation_familiale, nb_enfants_a_charge, statut_collaborateur, archive, gsm, email_professionnel, email_personnel")
        .in("id", collabIds);
      const collabsById: Record<string, any> = {};
      ((collabsRaw as any[]) || []).forEach(c => { collabsById[c.id] = c; });

      // 2bis) Contrats — RG-DECL-CIMR-CONTRAT : n'alimenter que les collaborateurs
      // ayant un contrat en cours sur au moins une partie du trimestre (même logique
      // que le wizard CNSS : démarré au plus tard à la fin de période, pas sorti
      // avant le début de période).
      const { data: contratsRaw } = await supabase.from("collaborateur_contrats")
        .select("collaborateur_id, code_statut_contrat, date_debut, date_sortie, archive")
        .in("collaborateur_id", collabIds)
        .eq("archive", false);
      const contratsByCollab: Record<string, any[]> = {};
      ((contratsRaw as any[]) || []).forEach(ct => {
        if (!contratsByCollab[ct.collaborateur_id]) contratsByCollab[ct.collaborateur_id] = [];
        contratsByCollab[ct.collaborateur_id].push(ct);
      });
      const aContratEnCoursSurPeriode = (collaborateurId: string): boolean =>
        (contratsByCollab[collaborateurId] || []).some(ct =>
          new Date(ct.date_debut) <= periodeFin &&
          (!ct.date_sortie || new Date(ct.date_sortie) >= periodeDebut)
        );

      // 3) Départs (pour code_enregistrement=7 + date de sortie)
      const { data: departsRaw } = await supabase.from("collaborateur_departs" as never)
        .select("collaborateur_id,date_depart,statut" as never)
        .in("collaborateur_id" as never, collabIds as never);
      const departByCollab: Record<string, any> = {};
      ((departsRaw as any[]) || []).forEach(d => { departByCollab[d.collaborateur_id] = d; });

      // 4) Périodes de calendrier_paie du trimestre, puis bulletins, puis lignes
      //    (proxy /db sans jointure : 3 requêtes séquentielles, comme le fait CNSS)
      const { data: periodesData } = await supabase.from("calendrier_paie" as never)
        .select("id, annee, mois" as never)
        .eq("annee" as never, annee as never)
        .in("mois" as never, moisDuTrimestre as never);
      const periodeIds = ((periodesData as any[]) || []).map(p => p.id);

      const bulletinsParCollab: Record<string, string[]> = {}; // collab_id -> [bulletin_id...] (jusqu'à 3)
      if (periodeIds.length > 0) {
        const { data: bulletinsData } = await supabase.from("bulletin" as never)
          .select("id, collaborateur_id, periode_id, statut" as never)
          .in("collaborateur_id" as never, collabIds as never)
          .in("periode_id" as never, periodeIds as never)
          .in("statut" as never, ["VALIDE", "CLOTURE"] as never);
        ((bulletinsData as any[]) || []).forEach((b: any) => {
          if (!bulletinsParCollab[b.collaborateur_id]) bulletinsParCollab[b.collaborateur_id] = [];
          bulletinsParCollab[b.collaborateur_id].push(b.id);
        });
      }

      const salaireParCollab: Record<string, number> = {};
      const tousBulletinIds = Object.values(bulletinsParCollab).flat();
      if (tousBulletinIds.length > 0) {
        const { data: lignesData } = await supabase.from("bulletin_ligne" as never)
          .select("bulletin_id, code_rubrique, montant" as never)
          .in("bulletin_id" as never, tousBulletinIds as never)
          .eq("code_rubrique" as never, rubriqueSalaireSoumis as never);
        const montantParBulletin: Record<string, number> = {};
        ((lignesData as any[]) || []).forEach((l: any) => { montantParBulletin[l.bulletin_id] = Number(l.montant) || 0; });
        Object.entries(bulletinsParCollab).forEach(([collabId, bIds]) => {
          salaireParCollab[collabId] = bIds.reduce((s, id) => s + (montantParBulletin[id] || 0), 0);
        });
      }

      // 5) Assembler les lignes
      const variantesByCode: Record<string, VarianteCimr> = {};
      variantesCimr.forEach(v => { variantesByCode[v.code_variante] = v; });

      const newLignes: DeclarationCimrLigne[] = affectations
        .filter(a => collabsById[a.collaborateur_id] && !collabsById[a.collaborateur_id].archive)
        .filter(a => aContratEnCoursSurPeriode(a.collaborateur_id))
        .map(a => {
          const c = collabsById[a.collaborateur_id];
          const depart = departByCollab[a.collaborateur_id];
          const estSortant = depart && depart.date_depart &&
            new Date(depart.date_depart) <= periodeFin && new Date(depart.date_depart) >= periodeDebut;

          const salaireSoumis = salaireParCollab[a.collaborateur_id] || 0;

          return {
            collaborateur_id: c.id,
            code_enregistrement: estSortant ? 7 : 2,
            matricule: c.matricule || "",
            cin: c.cin || "",
            num_cnss: c.num_cnss || "",
            gsm: c.gsm || "",
            email: c.email_professionnel || c.email_personnel || "",
            num_cimr: a.matricule_organisme || "",
            nom: c.nom || "",
            prenom: c.prenom || "",
            code_genre: c.code_genre || "",
            code_nationalite: c.code_nationalite || "",
            date_naissance: c.date_naissance || "",
            date_affiliation: a.date_affiliation || "",
            code_situation_familiale: c.code_situation_familiale || "",
            nb_enfants: c.nb_enfants_a_charge ?? null,
            salaire_soumis: salaireSoumis,
            date_sortie: estSortant ? depart.date_depart : "",
            code_variante_regime: a.code_variante_regime || "",
            code_categorie_base: a.code_categorie_base ?? null,
            taux_cotisation: a.valeur_bareme_taux ?? null,
            statut_salarie: estSortant ? "SORTANT" : "ACTIF",
            observations: "",
            est_valide: true,
          } as DeclarationCimrLigne;
        });

      setLignes(newLignes);
      const exclusAffiliation = affectationsBrutes.length - affectations.length;
      const exclusContrat = affectations.length - newLignes.length;
      let msg = `RG-DECL-CIMR-01 : ${newLignes.length} collaborateur(s) alimenté(s) pour ${TRIMESTRE_LABELS[trimestre]} ${annee}`;
      if (exclusAffiliation > 0) msg += ` — ${exclusAffiliation} exclu(s) (affiliation hors période)`;
      if (exclusContrat > 0) msg += ` — ${exclusContrat} exclu(s) (pas de contrat en cours)`;
      toast.success(msg);
    } catch (err: any) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  // ─── Étape 2 : Contrôle de cohérence ───────────────────────────────────
  const controler = () => {
    if (!societeInfo?.numeroAdherentCimr) {
      toast.error("Numéro d'adhérent CIMR manquant — à renseigner dans Société → Immatriculation avant de continuer");
    }
    let erreurs = 0;
    const updated = lignes.map(l => {
      const errs: string[] = [];
      const variante = variantesCimr.find(v => v.code_variante === l.code_variante_regime);

      if (!l.num_cimr || l.num_cimr.trim() === "") errs.push("Matricule CIMR manquant");
      if (!/^\d+$/.test(l.num_cimr || "")) errs.push("Matricule CIMR non numérique (champ 4 attend 9 chiffres)");
      if (!l.code_variante_regime || l.code_categorie_base === null) errs.push("Catégorie CIMR non renseignée (voir Fiche collaborateur)");
      if (l.taux_cotisation === null || l.taux_cotisation === undefined) errs.push("Taux de cotisation CIMR non choisi");
      if (!l.cin || l.cin.trim().length < 4) errs.push("CIN manquante ou invalide");
      if (l.salaire_soumis < 0) errs.push("Salaire soumis négatif");
      if (l.nb_enfants !== null && l.nb_enfants > 9) errs.push("Nombre d'enfants > 9, non représentable sur 1 position (champ 13)");
      if (l.code_enregistrement === 7 && !l.date_sortie) errs.push("Date de sortie manquante pour un salarié sortant");
      if (l.code_situation_familiale && !["C", "M", "D", "V"].includes(l.code_situation_familiale)) {
        errs.push(`Code situation familiale '${l.code_situation_familiale}' hors valeurs attendues (C/M/D/V)`);
      }

      const numeroCategorie = resoudreNumeroCategorie(variante, l.code_categorie_base, l.salaire_soumis);
      if (numeroCategorie === null && l.code_variante_regime) {
        errs.push("Impossible de résoudre le numéro de catégorie (variante introuvable dans le référentiel)");
      }

      if (errs.length > 0) erreurs++;
      return { ...l, est_valide: errs.length === 0, erreurs: errs.length > 0 ? errs : undefined, observations: errs.join(" | ") };
    });
    setLignes(updated);
    if (erreurs === 0) toast.success("RG-DECL-CIMR-03 : Contrôle réussi — aucune anomalie détectée");
    else toast.warning(`RG-DECL-CIMR-03 : ${erreurs} anomalie(s) détectée(s) — veuillez corriger`);
  };

  // ─── Sauvegarder en base ────────────────────────────────────────────────
  const sauvegarder = async (statut: string) => {
    setLoading(true);
    try {
      const totalSalaires = lignes.reduce((s, l) => s + (l.salaire_soumis || 0), 0);

      let declId = declaration?.id;
      if (!declId) {
        const { data: existingArr } = await supabase.from("cimr_declarations" as never)
          .select("id" as never).eq("trimestre" as never, trimestre as never).eq("annee" as never, annee as never);
        declId = (existingArr as any[])?.[0]?.id;
      }
      const payload = {
        trimestre, annee, statut, nombre_lignes: lignes.length, total_salaires: totalSalaires,
        numero_adherent: societeInfo?.numeroAdherentCimr || null, created_by: user?.id || null,
      };
      if (!declId) {
        const { data, error } = await supabase.from("cimr_declarations" as never)
          .insert(payload as never).select("id").single();
        if (error) throw error;
        declId = (data as any).id;
      } else {
        await supabase.from("cimr_declarations" as never).update(payload as never).eq("id" as never, declId as never);
      }

      await supabase.from("cimr_declaration_lignes" as never).delete().eq("declaration_id" as never, declId as never);

      const rows = lignes.map(l => {
        const variante = variantesCimr.find(v => v.code_variante === l.code_variante_regime);
        return {
          declaration_id: declId,
          collaborateur_id: l.collaborateur_id || null,
          code_enregistrement: l.code_enregistrement,
          numero_categorie: resoudreNumeroCategorie(variante, l.code_categorie_base, l.salaire_soumis),
          matricule_cimr: l.num_cimr,
          taux_cotisation: l.taux_cotisation,
          nom_prenom: `${l.nom} ${l.prenom}`.trim(),
          numero_interieur: l.matricule,
          sexe: sexeDeclare(l.code_genre),
          nationalite: nationaliteDeclaree(l.code_nationalite),
          date_affiliation: l.date_affiliation || null,
          date_naissance: l.date_naissance || null,
          situation_famille: l.code_situation_familiale || null,
          nombre_enfants: l.nb_enfants,
          salaire_soumis: l.salaire_soumis,
          date_sortie: l.date_sortie || null,
          num_cnie: l.cin,
          matricule_cnss: l.num_cnss,
          numero_gsm: l.gsm ? fmtGsm(l.gsm) : null,
          email: l.email || null,
          observations: l.observations,
          est_valide: l.est_valide,
          erreurs: l.erreurs || null,
        };
      });
      for (let i = 0; i < rows.length; i += 100) {
        const { error } = await supabase.from("cimr_declaration_lignes" as never).insert(rows.slice(i, i + 100) as never);
        if (error) throw error;
      }

      setDeclaration({ id: declId, trimestre, annee, statut, nombre_lignes: lignes.length, total_salaires: totalSalaires });
      toast.success(`Déclaration sauvegardée (${statut})`);
    } catch (err: any) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  // ─── Étape 3 : Génération du fichier ASCII 160 positions ───────────────
  const genererFichier = () => {
    if (!societeInfo?.numeroAdherentCimr) {
      toast.error("Numéro d'adhérent CIMR manquant — impossible de générer le fichier");
      return;
    }
    const lignesValides = lignes.filter(l => l.est_valide);
    if (lignesValides.length === 0) {
      toast.error("Aucune ligne valide pour générer le fichier");
      return;
    }

    const linesTxt = lignesValides.map(l =>
      construireChamps(l, societeInfo.numeroAdherentCimr, trimestre, annee, variantesCimr)
        .map(c => c.valeur).join("")
    );

    const contenu = linesTxt.join("\r\n"); // ANSI/CRLF, conforme aux fichiers texte Windows attendus par la CIMR
    const blob = new Blob([contenu], { type: "text/plain;charset=windows-1252" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `CIMR_${annee}_T${trimestre}.TXT`;
    a.click();
    URL.revokeObjectURL(url);

    sauvegarder("GENEREE");
    toast.success(`RG-DECL-CIMR-04 : Fichier généré (${lignesValides.length} salarié(s))`);
  };

  const lignesFiltrees = lignes.filter(l => {
    const matchSearch = !searchTerm ||
      `${l.nom} ${l.prenom} ${l.num_cimr} ${l.matricule}`.toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatut = filterStatut === "TOUS" ||
      (filterStatut === "ERREUR" ? !l.est_valide : l.statut_salarie === filterStatut);
    return matchSearch && matchStatut;
  });

  const inputStyle = { borderColor: "hsl(var(--border))", background: "hsl(var(--background))" };
  const steps = [
    { num: 0, label: "Paramétrage", icon: <Settings size={14} /> },
    { num: 1, label: "Alimentation", icon: <Users size={14} /> },
    { num: 2, label: "Contrôle", icon: <CheckCircle2 size={14} /> },
    { num: 3, label: "Génération", icon: <Download size={14} /> },
  ];

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Shield size={20} style={{ color: "hsl(var(--accent))" }} />
          <h1 className="text-xl font-bold">Déclaration CIMR trimestrielle</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setViewMode("wizard")}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold border"
            style={viewMode === "wizard" ? { background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" } : inputStyle}>
            Nouvelle déclaration
          </button>
          <button onClick={() => setViewMode("historique")}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold border"
            style={viewMode === "historique" ? { background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" } : inputStyle}>
            Historique
          </button>
        </div>
      </div>

      {!societeInfo?.numeroAdherentCimr && (
        <div className="flex items-center gap-2 mb-4 p-3 rounded-lg border"
          style={{ borderColor: "hsl(var(--destructive) / 0.3)", background: "hsl(var(--destructive) / 0.06)" }}>
          <AlertTriangle size={16} style={{ color: "hsl(var(--destructive))" }} />
          <span className="text-sm">
            Numéro d'adhérent CIMR non renseigné — allez dans <strong>Organisations → Sociétés → Immatriculation</strong> pour l'ajouter avant de générer une déclaration.
          </span>
        </div>
      )}

      {viewMode === "historique" ? (
        <div className="rounded-xl border" style={{ borderColor: "hsl(var(--border))" }}>
          {historiqueLoading ? (
            <p className="text-sm text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>Chargement…</p>
          ) : historique.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune déclaration CIMR enregistrée</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: "hsl(var(--border))" }}>
                  <th className="text-left py-2 px-3 text-xs font-semibold uppercase" style={{ color: "hsl(var(--muted-foreground))" }}>Période</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold uppercase" style={{ color: "hsl(var(--muted-foreground))" }}>Statut</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold uppercase" style={{ color: "hsl(var(--muted-foreground))" }}>Lignes</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold uppercase" style={{ color: "hsl(var(--muted-foreground))" }}>Total salaires</th>
                  <th className="w-24"></th>
                </tr>
              </thead>
              <tbody>
                {historique.map(d => (
                  <tr key={d.id} className="border-b" style={{ borderColor: "hsl(var(--border))" }}>
                    <td className="py-2 px-3">{TRIMESTRE_LABELS[d.trimestre]} {d.annee}</td>
                    <td className="py-2 px-3">
                      <StatutSelector code={d.statut} onChange={(nouveau) => changerStatut(d.id!, nouveau)} />
                    </td>
                    <td className="py-2 px-3 text-right">{d.nombre_lignes}</td>
                    <td className="py-2 px-3 text-right">{d.total_salaires?.toLocaleString("fr-FR")} DH</td>
                    <td className="py-2 px-3 text-right">
                      {estVerrouillee(d.statut) && (
                        <button onClick={() => ouvrirConsultation(d)}
                          className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md ml-auto"
                          style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                          <Eye size={12} /> Consulter
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <>
          {/* ─── Barre d'étapes ─── */}
          <div className="flex items-center gap-2 mb-6">
            {steps.map((s, i) => (
              <React.Fragment key={s.num}>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold"
                  style={step === s.num
                    ? { background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }
                    : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                  {s.icon} {s.label}
                </div>
                {i < steps.length - 1 && <ArrowRight size={14} style={{ color: "hsl(var(--muted-foreground))" }} />}
              </React.Fragment>
            ))}
          </div>

          {/* ─── Étape 0 : Paramétrage ─── */}
          {step === 0 && (
            <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: "hsl(var(--border))" }}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold uppercase" style={{ color: "hsl(var(--muted-foreground))" }}>Trimestre</label>
                  <select value={trimestre} onChange={e => setTrimestre(Number(e.target.value))}
                    className="w-full mt-1 px-3 py-2 rounded-lg border text-sm" style={inputStyle}>
                    {[1, 2, 3, 4].map(t => <option key={t} value={t}>{TRIMESTRE_LABELS[t]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase" style={{ color: "hsl(var(--muted-foreground))" }}>Année</label>
                  <input type="number" value={annee} onChange={e => setAnnee(Number(e.target.value))}
                    className="w-full mt-1 px-3 py-2 rounded-lg border text-sm" style={inputStyle} />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Rubrique source du salaire soumis
                </label>
                <select value={rubriqueSalaireSoumis} onChange={e => sauvegarderRubriqueSource(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-lg border text-sm" style={inputStyle}>
                  {rubriquesDisponibles.map(r => (
                    <option key={r.code} value={r.code}>{r.libelle} ({r.code})</option>
                  ))}
                </select>
                <p className="text-[11px] mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Par défaut ASSIETTE_CIMR — modifiable si la rubrique change, sans toucher au code.
                </p>
              </div>

              <div className="flex items-start gap-2 p-3 rounded-lg" style={{ background: "hsl(var(--muted))" }}>
                <Info size={14} className="mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--muted-foreground))" }} />
                <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Le salaire soumis sera agrégé sur les 3 mois du trimestre ({3 * trimestre - 2}, {3 * trimestre - 1}, {3 * trimestre}/{annee}),
                  à partir des bulletins validés ou clôturés uniquement.
                </p>
              </div>

              <div className="flex justify-end">
                <button onClick={() => setStep(1)}
                  className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-semibold"
                  style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
                  Continuer <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* ─── Étape 1 : Alimentation ─── */}
          {step === 1 && (
            <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: "hsl(var(--border))" }}>
              <div className="flex justify-between items-center">
                <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {TRIMESTRE_LABELS[trimestre]} {annee} — {lignes.length} collaborateur(s) alimenté(s)
                </p>
                <button onClick={alimenterAuto} disabled={loading}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                  style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
                  {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  {loading ? "Alimentation…" : "Alimenter automatiquement"}
                </button>
              </div>

              {lignes.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b" style={{ borderColor: "hsl(var(--border))" }}>
                        <th className="text-left py-2 px-2">Matricule</th>
                        <th className="text-left py-2 px-2">Nom</th>
                        <th className="text-left py-2 px-2">N° CIMR</th>
                        <th className="text-left py-2 px-2">Catégorie</th>
                        <th className="text-right py-2 px-2">Taux</th>
                        <th className="text-right py-2 px-2">Salaire soumis</th>
                        <th className="text-left py-2 px-2">Statut</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lignes.map((l, i) => (
                        <tr key={i} className="border-b" style={{ borderColor: "hsl(var(--border))" }}>
                          <td className="py-1.5 px-2">{l.matricule}</td>
                          <td className="py-1.5 px-2">{l.nom} {l.prenom}</td>
                          <td className="py-1.5 px-2 font-mono">{l.num_cimr || "—"}</td>
                          <td className="py-1.5 px-2">{l.code_variante_regime || "—"}</td>
                          <td className="py-1.5 px-2 text-right">{l.taux_cotisation != null ? `${l.taux_cotisation.toFixed(2)}%` : "—"}</td>
                          <td className="py-1.5 px-2 text-right">{l.salaire_soumis.toLocaleString("fr-FR")} DH</td>
                          <td className="py-1.5 px-2">{l.statut_salarie}</td>
                          <td className="py-1.5 px-2 text-center">
                            <button onClick={() => setLigneDetail(l)} title="Voir le détail des champs déclarés" className="p-1 rounded hover:bg-muted">
                              <Eye size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex justify-between">
                <button onClick={() => setStep(0)}
                  className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-semibold border" style={inputStyle}>
                  <ArrowLeft size={14} /> Retour
                </button>
                <button onClick={() => setStep(2)} disabled={lignes.length === 0}
                  className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
                  style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
                  Continuer <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* ─── Étape 2 : Contrôle ─── */}
          {step === 2 && (
            <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: "hsl(var(--border))" }}>
              <div className="flex justify-between items-center gap-3">
                <div className="flex gap-2 flex-1">
                  <div className="relative flex-1">
                    <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
                    <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                      placeholder="Rechercher…" className="w-full pl-7 pr-2 py-1.5 rounded-lg border text-sm" style={inputStyle} />
                  </div>
                  <select value={filterStatut} onChange={e => setFilterStatut(e.target.value)}
                    className="px-2 py-1.5 rounded-lg border text-sm" style={inputStyle}>
                    <option value="TOUS">Tous</option>
                    <option value="ACTIF">Actifs</option>
                    <option value="SORTANT">Sortants</option>
                    <option value="ERREUR">En erreur</option>
                  </select>
                </div>
                <button onClick={controler}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
                  <CheckCircle2 size={12} /> Lancer le contrôle
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b" style={{ borderColor: "hsl(var(--border))" }}>
                      <th className="text-left py-2 px-2">Nom</th>
                      <th className="text-left py-2 px-2">N° CIMR</th>
                      <th className="text-left py-2 px-2">Catégorie</th>
                      <th className="text-right py-2 px-2">Salaire</th>
                      <th className="text-left py-2 px-2">Statut</th>
                      <th className="text-left py-2 px-2">Observations</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lignesFiltrees.map((l, i) => (
                      <tr key={i} className="border-b" style={{ borderColor: "hsl(var(--border))" }}>
                        <td className="py-1.5 px-2">{l.nom} {l.prenom}</td>
                        <td className="py-1.5 px-2 font-mono">{l.num_cimr || "—"}</td>
                        <td className="py-1.5 px-2">{l.code_variante_regime || "—"}</td>
                        <td className="py-1.5 px-2 text-right">{l.salaire_soumis.toLocaleString("fr-FR")} DH</td>
                        <td className="py-1.5 px-2">
                          {l.est_valide ? (
                            <span className="text-xs px-2 py-0.5 rounded font-semibold" style={{ background: "hsl(var(--success) / 0.12)", color: "hsl(var(--success))" }}>Valide</span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded font-semibold" style={{ background: "hsl(var(--destructive) / 0.1)", color: "hsl(var(--destructive))" }}>Erreur</span>
                          )}
                        </td>
                        <td className="py-1.5 px-2" style={{ color: "hsl(var(--destructive))" }}>{l.observations}</td>
                        <td className="py-1.5 px-2 text-center">
                          <button onClick={() => setLigneDetail(l)} title="Voir le détail des champs déclarés" className="p-1 rounded hover:bg-muted">
                            <Eye size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between">
                <button onClick={() => setStep(1)}
                  className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-semibold border" style={inputStyle}>
                  <ArrowLeft size={14} /> Retour
                </button>
                <div className="flex gap-2">
                  <button onClick={() => sauvegarder("VALIDE")} disabled={loading || lignes.some(l => !l.est_valide)}
                    title={lignes.some(l => !l.est_valide) ? "Corrigez les lignes en erreur avant de valider" : "Enregistrer la déclaration comme validée"}
                    className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-semibold border disabled:opacity-50" style={inputStyle}>
                    <CheckCircle2 size={14} /> Valider
                  </button>
                  <button onClick={() => setStep(3)}
                    className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-semibold"
                    style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
                    Continuer <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ─── Étape 3 : Génération ─── */}
          {step === 3 && (
            <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: "hsl(var(--border))" }}>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-4 rounded-xl border flex items-center gap-3"
                  style={{ background: "hsl(var(--success) / 0.08)", borderColor: "hsl(var(--success) / 0.2)" }}>
                  <div className="p-2 rounded-lg" style={{ background: "hsl(var(--success) / 0.15)" }}>
                    <CheckCircle2 size={16} style={{ color: "hsl(var(--success))" }} />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-semibold" style={{ color: "hsl(var(--success))" }}>Salariés valides</p>
                    <p className="text-lg font-bold" style={{ color: "hsl(var(--success))" }}>{lignes.filter(l => l.est_valide).length} / {lignes.length}</p>
                  </div>
                </div>
                <div className="p-4 rounded-xl border flex items-center gap-3"
                  style={{ background: "hsl(var(--primary) / 0.06)", borderColor: "hsl(var(--primary) / 0.2)" }}>
                  <div className="p-2 rounded-lg" style={{ background: "hsl(var(--primary) / 0.12)" }}>
                    <Wallet size={16} style={{ color: "hsl(var(--primary))" }} />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-semibold" style={{ color: "hsl(var(--primary))" }}>Total salaires soumis</p>
                    <p className="text-lg font-bold" style={{ color: "hsl(var(--primary))" }}>{lignes.reduce((s, l) => s + l.salaire_soumis, 0).toLocaleString("fr-FR")} DH</p>
                  </div>
                </div>
                <div className="p-4 rounded-xl border flex items-center gap-3"
                  style={{ background: "hsl(var(--accent) / 0.06)", borderColor: "hsl(var(--accent) / 0.2)" }}>
                  <div className="p-2 rounded-lg" style={{ background: "hsl(var(--accent) / 0.12)" }}>
                    <Building2 size={16} style={{ color: "hsl(var(--accent))" }} />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-semibold" style={{ color: "hsl(var(--accent))" }}>N° adhérent</p>
                    <p className="text-lg font-bold font-mono" style={{ color: "hsl(var(--accent))" }}>{societeInfo?.numeroAdherentCimr || "—"}</p>
                  </div>
                </div>
              </div>

              {lignes.some(l => !l.est_valide) && (
                <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: "hsl(var(--warning) / 0.12)" }}>
                  <AlertTriangle size={14} style={{ color: "hsl(var(--warning))" }} />
                  <span className="text-xs">
                    {lignes.filter(l => !l.est_valide).length} ligne(s) en erreur seront exclues du fichier généré.
                  </span>
                </div>
              )}

              <div className="flex justify-between">
                <button onClick={() => setStep(2)}
                  className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-semibold border" style={inputStyle}>
                  <ArrowLeft size={14} /> Retour
                </button>
                <button onClick={genererFichier} disabled={loading}
                  className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
                  style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
                  <Download size={14} /> Générer le fichier CIMR_{annee}_T{trimestre}.TXT
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── Modal détail des 21 champs (aperçu exact de ce qui sera écrit) ─── */}
      {ligneDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "hsl(0 0% 0% / 0.5)" }}
          onClick={() => setLigneDetail(null)}>
          <div className="rounded-xl border w-full max-w-2xl max-h-[85vh] overflow-y-auto"
            style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))" }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b sticky top-0" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))" }}>
              <div>
                <p className="text-sm font-bold">{ligneDetail.nom} {ligneDetail.prenom}</p>
                <p className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Aperçu des 21 champs — {TRIMESTRE_LABELS[trimestre]} {annee}
                </p>
              </div>
              <button onClick={() => setLigneDetail(null)} className="p-1 rounded hover:bg-muted">
                <X size={16} />
              </button>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b" style={{ borderColor: "hsl(var(--border))" }}>
                  <th className="text-left py-2 px-3">#</th>
                  <th className="text-left py-2 px-3">Champ</th>
                  <th className="text-center py-2 px-3">Type</th>
                  <th className="text-center py-2 px-3">Long.</th>
                  <th className="text-left py-2 px-3">Valeur qui sera écrite</th>
                </tr>
              </thead>
              <tbody>
                {construireChamps(ligneDetail, societeInfo?.numeroAdherentCimr || "", trimestre, annee, variantesCimr).map(c => {
                  const vide = !c.valeur.trim() || /^0+$/.test(c.valeur);
                  return (
                    <tr key={c.position} className="border-b" style={{ borderColor: "hsl(var(--border))" }}>
                      <td className="py-1.5 px-3" style={{ color: "hsl(var(--muted-foreground))" }}>{c.position}</td>
                      <td className="py-1.5 px-3">{c.libelle}</td>
                      <td className="py-1.5 px-3 text-center font-mono">{c.type}</td>
                      <td className="py-1.5 px-3 text-center">{c.longueur}</td>
                      <td className="py-1.5 px-3 font-mono" style={vide ? { color: "hsl(var(--destructive))" } : undefined}>
                        "{c.valeur}"
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="p-3 text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
              En rouge : champs vides ou à zéro — à vérifier avant génération.
            </div>
          </div>
        </div>
      )}

      {/* ─── Consultation en lecture seule (Traité / Archivé) ─── */}
      {consultation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "hsl(0 0% 0% / 0.5)" }}
          onClick={() => setConsultation(null)}>
          <div className="rounded-xl border w-full max-w-5xl max-h-[85vh] overflow-y-auto"
            style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))" }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b sticky top-0" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))" }}>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg" style={{ background: "hsl(var(--muted))" }}>
                  <Shield size={16} style={{ color: "hsl(var(--muted-foreground))" }} />
                </div>
                <div>
                  <p className="text-sm font-bold">
                    {TRIMESTRE_LABELS[consultation.declaration.trimestre]} {consultation.declaration.annee} — Consultation
                  </p>
                  <p className="text-[11px] flex items-center gap-1.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                    <StatutBadge code={consultation.declaration.statut} /> · déclaration verrouillée, non modifiable
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => navigate(-1)}
                  className="px-3 py-1.5 rounded-lg border text-xs font-medium hover:bg-muted" style={inputStyle}>
                  ← Retour
                </button>
                <button onClick={() => setConsultation(null)} className="p-1 rounded hover:bg-muted">
                  <X size={16} />
                </button>
              </div>
            </div>

            {!consultationLoading && consultation.lignes.length > 0 && (
              <div className="flex gap-2 p-3 border-b" style={{ borderColor: "hsl(var(--border))" }}>
                <div className="relative flex-1">
                  <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
                  <input value={consultationSearch} onChange={e => setConsultationSearch(e.target.value)}
                    placeholder="Rechercher un nom, un matricule CIMR…"
                    className="w-full pl-7 pr-2 py-1.5 rounded-lg border text-sm" style={inputStyle} />
                </div>
                <select value={consultationFilter} onChange={e => setConsultationFilter(e.target.value)}
                  className="px-2 py-1.5 rounded-lg border text-sm" style={inputStyle}>
                  <option value="TOUS">Tous les statuts</option>
                  <option value="VALIDE">Valides</option>
                  <option value="ERREUR">En erreur</option>
                </select>
              </div>
            )}

            {(() => {
              const lignesFiltreesConsult = consultation.lignes.filter((l: any) => {
                const matchSearch = !consultationSearch ||
                  `${l.nom_prenom} ${l.matricule_cimr} ${l.num_cnie}`.toLowerCase().includes(consultationSearch.toLowerCase());
                const matchStatut = consultationFilter === "TOUS" ||
                  (consultationFilter === "ERREUR" ? !l.est_valide : l.est_valide);
                return matchSearch && matchStatut;
              });

              return consultationLoading ? (
              <p className="text-sm text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>Chargement…</p>
            ) : consultation.lignes.length === 0 ? (
              <p className="text-sm text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune ligne enregistrée pour cette déclaration</p>
            ) : lignesFiltreesConsult.length === 0 ? (
              <p className="text-sm text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune ligne ne correspond à ce filtre</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b sticky" style={{ borderColor: "hsl(var(--border))" }}>
                    <th className="text-left py-2 px-3">Nom et prénom</th>
                    <th className="text-left py-2 px-3">N° CIMR</th>
                    <th className="text-center py-2 px-3">Catégorie</th>
                    <th className="text-right py-2 px-3">Taux</th>
                    <th className="text-right py-2 px-3">Salaire soumis</th>
                    <th className="text-left py-2 px-3">CNIE</th>
                    <th className="text-left py-2 px-3">Matricule CNSS</th>
                    <th className="text-center py-2 px-3">Statut ligne</th>
                  </tr>
                </thead>
                <tbody>
                  {lignesFiltreesConsult.map((l: any) => (
                    <tr key={l.id} className="border-b" style={{ borderColor: "hsl(var(--border))" }}>
                      <td className="py-1.5 px-3">{l.nom_prenom}</td>
                      <td className="py-1.5 px-3 font-mono">{l.matricule_cimr}</td>
                      <td className="py-1.5 px-3 text-center font-mono">{String(l.numero_categorie).padStart(2, "0")}</td>
                      <td className="py-1.5 px-3 text-right">{l.taux_cotisation != null ? `${Number(l.taux_cotisation).toFixed(2)}%` : "—"}</td>
                      <td className="py-1.5 px-3 text-right">{Number(l.salaire_soumis || 0).toLocaleString("fr-FR")} DH</td>
                      <td className="py-1.5 px-3">{l.num_cnie}</td>
                      <td className="py-1.5 px-3">{l.matricule_cnss}</td>
                      <td className="py-1.5 px-3 text-center">
                        {l.est_valide ? (
                          <span className="text-[10px] px-2 py-0.5 rounded font-semibold" style={{ background: "hsl(var(--success) / 0.12)", color: "hsl(var(--success))" }}>Valide</span>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded font-semibold" style={{ background: "hsl(var(--destructive) / 0.1)", color: "hsl(var(--destructive))" }}>Erreur</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};

export default DeclarationCimrPage;
