/**
 * DeclarationCnssPage – Déclaration CNSS en 4 étapes
 * RG-DECL-CNSS-01 : Import du fichier préétabli (CSV/Excel ou XML)
 * RG-DECL-CNSS-02 : Alimentation automatique des salaires et jours, mise à jour statut
 * RG-DECL-CNSS-03 : Contrôle CIN, détection entrants et collaborateurs sans N°CNSS
 * RG-DECL-CNSS-04 : Génération du fichier XML Damancom
 */
import React, { useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { postForBlob } from "@/lib/api";
import { StatutSelector, type CodeStatutDeclaration } from "@/components/paie/StatutDeclaration";
import {
  Shield, FileText, Upload, CheckCircle2, AlertTriangle, Download,
  Loader2, ArrowRight, ArrowLeft, Users, RefreshCw, Search, Eye, X,
  FileUp, Calendar, Info, Pencil, Save, Settings
} from "lucide-react";

const MOIS_LABELS = [
  "", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
];

interface DeclarationLigne {
  id?: string;
  collaborateur_id?: string;
  matricule: string;
  cin: string;
  num_cnss: string;
  nom: string;
  prenom: string;
  salaire_brut: number;
  salaire_brut_declare?: number;
  nombre_jours: number;
  statut_salarie: string;
  observations: string;
  est_valide: boolean;
  erreurs?: any;
}

interface Declaration {
  id?: string;
  mois: number;
  annee: number;
  statut: string;
  nombre_lignes: number;
  total_salaires: number;
  total_jours: number;
  fichier_xml_path?: string | null;
  created_at?: string;
}

const DeclarationCnssPage: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<"wizard" | "historique">("wizard");
  const [historique, setHistorique] = useState<Declaration[]>([]);
  const [historiqueLoading, setHistoriqueLoading] = useState(false);
  const [consultationMode, setConsultationMode] = useState(false);
  const [societeInfo, setSocieteInfo] = useState<{ raisonSociale: string; numAffilieCnss: string } | null>(null);
  const [step, setStep] = useState(1);
  const [mois, setMois] = useState(new Date().getMonth() + 1);
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [declaration, setDeclaration] = useState<Declaration | null>(null);
  const [lignes, setLignes] = useState<DeclarationLigne[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatut, setFilterStatut] = useState("TOUS");
  const [importMode, setImportMode] = useState<"file" | "auto">("auto");
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editRow, setEditRow] = useState<Partial<DeclarationLigne>>({});
  // RG-DECL-CNSS-PARAM : Paramètres système CNSS depuis ref_constante_paie
  const [paramsCnss, setParamsCnss] = useState({
    plafondJours: 26,
    plafondBase: 6000,
    tauxSalarial: 4.48,
    tauxPatronal: 8.98,
    deadlineJour: 10,
    rubriqueSalaireBrut: "",
    rubriqueNbrJours: "",
    tauxAF: 6.40,
    tauxTFP: 1.60,
    tauxAmoSalarial: 1.85,
    tauxAmoPatronal: 4.52,
  });
  const [paramsLoaded, setParamsLoaded] = useState(false);
  // Rubriques disponibles pour la sélection source
  const [rubriquesDisponibles, setRubriquesDisponibles] = useState<{
    code: string; libelle: string; zone_fixe_key: string | null; code_type: string | null;
    alimentations: { code_attribut: string; source_type: string }[];
  }[]>([]);
  // Résolution des sources configurées
  const [sourceSalaire, setSourceSalaire] = useState<{ code: string; libelle: string; zone_fixe_key: string | null } | null>(null);
  const [sourceJours, setSourceJours] = useState<{ code: string; libelle: string; zone_fixe_key: string | null } | null>(null);
  // Attribut et type sélectionnés pour les sources
  const [salaireSrcAttribut, setSalaireSrcAttribut] = useState("");
  const [salaireSrcType, setSalaireSrcType] = useState("");
  const [joursSrcAttribut, setJoursSrcAttribut] = useState("");
  const [joursSrcType, setJoursSrcType] = useState("");
  // Référentiel des statuts CNSS
  const [statutsCnss, setStatutsCnss] = useState<{ code: string; libelle: string; description: string | null }[]>([
    { code: "ACTIF", libelle: "Actif", description: null },
    { code: "ENTRANT", libelle: "Entrant", description: null },
    { code: "SORTANT", libelle: "Sortant", description: null },
  ]);

  // Attributs et types standards (comme dans la valorisation des rubriques)
  const ATTRIBUTS_STANDARD = [
    { code: "BASE", label: "Nombre" },
    { code: "TAUX", label: "Taux" },
    { code: "MONT", label: "Montant" },
    { code: "DATE", label: "Date" },
    { code: "TEXT", label: "Texte" },
  ];
  const TYPES_SOURCE_STANDARD = [
    { code: "TABLE", label: "Table" },
    { code: "RUBRIQUE", label: "Périodique" },
    { code: "RUBRIQUE_CUMUL", label: "Cumulée" },
    { code: "CONSTANTE", label: "Constante" },
  ];

  useEffect(() => {
    const loadStatuts = async () => {
      const { data } = await supabase
        .from("ref_statut_cnss" as never)
        .select("code, libelle, description" as never)
        .eq("actif" as never, true as never);
      if (data && (data as any[]).length > 0) {
        setStatutsCnss((data as any[]).map((d: any) => ({ code: d.code, libelle: d.libelle, description: d.description || null })));
      }
    };
    loadStatuts();
  }, []);

  // Charger les rubriques disponibles avec type et alimentations
  useEffect(() => {
    const loadRubriques = async () => {
      const { data: rubs } = await supabase
        .from("rubrique_paie" as never)
        .select("code, libelle, code_type" as never)
        .eq("archive" as never, false as never);
      const { data: alims } = await supabase
        .from("rubrique_paie_alimentation" as never)
        .select("code_rubrique, code_attribut, source_type" as never);
      const alimMap: Record<string, { code_attribut: string; source_type: string }[]> = {};
      ((alims || []) as any[]).forEach((a: any) => {
        if (!alimMap[a.code_rubrique]) alimMap[a.code_rubrique] = [];
        alimMap[a.code_rubrique].push({ code_attribut: a.code_attribut, source_type: a.source_type });
      });
      if (rubs) {
        setRubriquesDisponibles((rubs as any[]).map((r: any) => ({
          code: r.code,
          libelle: r.libelle,
          zone_fixe_key: r.zone_fixe_key || null,
          code_type: r.code_type || null,
          alimentations: alimMap[r.code] || [],
        })));
      }
    };
    loadRubriques();
  }, []);

  useEffect(() => {
    const loadParams = async () => {
      const { data } = await supabase
        .from("ref_constante_paie" as never)
        .select("code, valeur" as never)
        .in("code" as never, [
          "CNSS_PLAFOND_JOURS", "CNSS_PLAFOND_BASE", "CNSS_TAUX_SALARIAL", "CNSS_TAUX_PATRONAL",
          "CNSS_DEADLINE_JOUR", "CNSS_RUBRIQUE_SALAIRE_BRUT", "CNSS_RUBRIQUE_NBR_JOURS",
          "CNSS_TAUX_AF", "CNSS_TAUX_TFP", "CNSS_TAUX_AMO_SALARIAL", "CNSS_TAUX_AMO_PATRONAL",
        ] as never);

      if (data && (data as any[]).length > 0) {
        const map: Record<string, string> = {};
        (data as any[]).forEach((d: any) => { map[d.code] = d.valeur || ""; });
        setParamsCnss({
          plafondJours: parseFloat(map["CNSS_PLAFOND_JOURS"]) || 26,
          plafondBase: parseFloat(map["CNSS_PLAFOND_BASE"]) || 6000,
          tauxSalarial: parseFloat(map["CNSS_TAUX_SALARIAL"]) || 4.48,
          tauxPatronal: parseFloat(map["CNSS_TAUX_PATRONAL"]) || 8.98,
          deadlineJour: parseFloat(map["CNSS_DEADLINE_JOUR"]) || 10,
          rubriqueSalaireBrut: map["CNSS_RUBRIQUE_SALAIRE_BRUT"] || "",
          rubriqueNbrJours: map["CNSS_RUBRIQUE_NBR_JOURS"] || "",
          tauxAF: parseFloat(map["CNSS_TAUX_AF"]) || 6.40,
          tauxTFP: parseFloat(map["CNSS_TAUX_TFP"]) || 1.60,
          tauxAmoSalarial: parseFloat(map["CNSS_TAUX_AMO_SALARIAL"]) || 1.85,
          tauxAmoPatronal: parseFloat(map["CNSS_TAUX_AMO_PATRONAL"]) || 4.52,
        });
      }
      setParamsLoaded(true);
    };
    loadParams();
  }, []);

  // Résoudre les rubriques sources quand params et rubriques sont chargés
  useEffect(() => {
    if (!paramsLoaded || rubriquesDisponibles.length === 0) return;
    if (paramsCnss.rubriqueSalaireBrut) {
      const found = rubriquesDisponibles.find(r => r.code === paramsCnss.rubriqueSalaireBrut);
      setSourceSalaire(found || null);
    } else {
      setSourceSalaire(null);
    }
    if (paramsCnss.rubriqueNbrJours) {
      const found = rubriquesDisponibles.find(r => r.code === paramsCnss.rubriqueNbrJours);
      setSourceJours(found || null);
    } else {
      setSourceJours(null);
    }
  }, [paramsLoaded, paramsCnss.rubriqueSalaireBrut, paramsCnss.rubriqueNbrJours, rubriquesDisponibles]);

  // Sauvegarder le choix d'une rubrique source
  const saveSourceRubrique = async (constCode: string, rubriqueCode: string) => {
    try {
      const { error } = await supabase
        .from("ref_constante_paie")
        .update({ valeur: rubriqueCode } as any)
        .eq("code", constCode);
      if (error) throw error;
      setParamsCnss(prev => ({
        ...prev,
        [constCode === "CNSS_RUBRIQUE_SALAIRE_BRUT" ? "rubriqueSalaireBrut" : "rubriqueNbrJours"]: rubriqueCode,
      }));
      toast.success(`Source ${constCode === "CNSS_RUBRIQUE_SALAIRE_BRUT" ? "salaire brut" : "nombre de jours"} mise à jour`);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Sauvegarder un paramètre numérique CNSS
  const saveParamCnss = async (constCode: string, value: string) => {
    try {
      const { error } = await supabase
        .from("ref_constante_paie")
        .update({ valeur: value } as any)
        .eq("code", constCode);
      if (error) throw error;
      const numVal = parseFloat(value) || 0;
      const keyMap: Record<string, string> = {
        CNSS_PLAFOND_JOURS: "plafondJours",
        CNSS_PLAFOND_BASE: "plafondBase",
        CNSS_TAUX_SALARIAL: "tauxSalarial",
        CNSS_TAUX_PATRONAL: "tauxPatronal",
        CNSS_DEADLINE_JOUR: "deadlineJour",
        CNSS_TAUX_AF: "tauxAF",
        CNSS_TAUX_TFP: "tauxTFP",
        CNSS_TAUX_AMO_SALARIAL: "tauxAmoSalarial",
        CNSS_TAUX_AMO_PATRONAL: "tauxAmoPatronal",
      };
      if (keyMap[constCode]) {
        setParamsCnss(prev => ({ ...prev, [keyMap[constCode]]: numVal }));
      }
      toast.success("Paramètre mis à jour");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // ─── Étape 1 : Initialiser ou charger une déclaration ───
  const initDeclaration = async (moisOverride?: number, anneeOverride?: number) => {
    const moisCible = moisOverride ?? mois;
    const anneeCible = anneeOverride ?? annee;
    setLoading(true);
    try {
      // Vérifier si une déclaration existe déjà
      const { data: existingArr } = await supabase
        .from("cnss_declarations" as never)
        .select("*")
        .eq("mois" as never, moisCible as never)
        .eq("annee" as never, anneeCible as never);
      const existing = (existingArr as any[])?.[0];

      if (existing) {
        setDeclaration(existing as any);
        // Charger les lignes
        const { data: l, error: errLignes } = await supabase
          .from("cnss_declaration_lignes" as never)
          .select("*")
          .eq("declaration_id" as never, existing.id as never)
          .order("nom" as never);
        if (errLignes) {
          toast.error(`Erreur de chargement des lignes : ${errLignes.message}`);
          setLignes([]);
        } else {
          setLignes((l || []) as any);
          toast.info(`Déclaration ${MOIS_LABELS[moisCible]} ${anneeCible} chargée (${(l as any[])?.length || 0} lignes)`);
        }
      } else {
        setDeclaration(null);
        setLignes([]);
      }
    } catch (e: any) {
      toast.error(e.message);
    }
    setLoading(false);
  };

  // Ouvrir une déclaration active depuis l'historique (bascule en mode assistant sur l'étape Contrôle).
  // Réservé aux statuts encore modifiables — TRAITEE/ARCHIVEE passent par
  // ouvrirConsultationCnss (panneau séparé, aucune action de régénération possible).
  const ouvrirDepuisHistorique = async (d: Declaration) => {
    setMois(d.mois);
    setAnnee(d.annee);
    setConsultationMode(false);
    setViewMode("wizard");
    setStep(3);
    await initDeclaration(d.mois, d.annee);
  };

  // ─── Consultation en lecture seule (Traité / Archivé) ───────────────────
  // RG-DECL-CNSS-CONSULT : un panneau dédié, hors du wizard, pour qu'il soit
  // structurellement impossible de relancer "Génération XML" sur une
  // déclaration déjà transmise/traitée/archivée.
  const [consultationCnss, setConsultationCnss] = useState<{ declaration: Declaration; lignes: any[] } | null>(null);
  const [consultationCnssLoading, setConsultationCnssLoading] = useState(false);
  const [consultationCnssSearch, setConsultationCnssSearch] = useState("");
  const [consultationCnssFilter, setConsultationCnssFilter] = useState("TOUS");

  const ouvrirConsultationCnss = async (d: Declaration) => {
    setConsultationCnssLoading(true);
    const { data, error } = await supabase.from("cnss_declaration_lignes" as never)
      .select("*" as never).eq("declaration_id" as never, d.id as never)
      .order("nom" as never);
    if (error) { toast.error(error.message); setConsultationCnssLoading(false); return; }
    setConsultationCnss({ declaration: d, lignes: (data as any[]) || [] });
    setConsultationCnssSearch("");
    setConsultationCnssFilter("TOUS");
    setConsultationCnssLoading(false);
  };
  const estVerrouilleeCnss = (statut: string) => statut === "TRAITEE" || statut === "ARCHIVEE";

  function renderConsultationCnss() {
    if (!consultationCnss) return null;
        const lignesFiltreesConsult = consultationCnss.lignes.filter((l: any) => {
          const matchSearch = !consultationCnssSearch ||
            `${l.nom} ${l.prenom} ${l.matricule} ${l.cin} ${l.num_cnss}`.toLowerCase().includes(consultationCnssSearch.toLowerCase());
          const matchStatut = consultationCnssFilter === "TOUS" ||
            (consultationCnssFilter === "ERREUR" ? !l.est_valide : l.statut_salarie === consultationCnssFilter);
          return matchSearch && matchStatut;
        });
        const kpi = {
          total: consultationCnss.lignes.length,
          actifs: consultationCnss.lignes.filter((l: any) => l.statut_salarie === "ACTIF").length,
          entrants: consultationCnss.lignes.filter((l: any) => l.statut_salarie === "ENTRANT").length,
          sortants: consultationCnss.lignes.filter((l: any) => l.statut_salarie === "SORTANT").length,
        };
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
            onClick={() => setConsultationCnss(null)}>
            <div className="rounded-xl border border-border bg-background w-full max-w-6xl max-h-[85vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-background z-10">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <Shield size={16} className="text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-bold">
                      {MOIS_LABELS[consultationCnss.declaration.mois]} {consultationCnss.declaration.annee} — Consultation
                    </p>
                    <p className="text-[11px] flex items-center gap-1.5 text-muted-foreground">
                      🔒 {consultationCnss.declaration.statut === "TRAITEE" ? "Traitée" : "Archivée"} · déclaration verrouillée, non modifiable
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => navigate(-1)}
                    className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-muted">
                    ← Retour
                  </button>
                  <button onClick={() => setConsultationCnss(null)} className="p-1 rounded hover:bg-muted">
                    <X size={16} />
                  </button>
                </div>
              </div>

              {!consultationCnssLoading && consultationCnss.lignes.length > 0 && (
                <>
                  <div className="grid grid-cols-4 gap-3 p-4">
                    <div className="rounded-xl bg-muted/50 p-4 text-center">
                      <p className="text-2xl font-bold">{kpi.total}</p>
                      <p className="text-xs text-muted-foreground">Salariés</p>
                    </div>
                    <div className="rounded-xl p-4 text-center" style={{ background: "hsl(var(--success) / 0.08)" }}>
                      <p className="text-2xl font-bold" style={{ color: "hsl(var(--success))" }}>{kpi.actifs}</p>
                      <p className="text-xs" style={{ color: "hsl(var(--success))" }}>Actifs</p>
                    </div>
                    <div className="rounded-xl p-4 text-center" style={{ background: "hsl(var(--primary) / 0.06)" }}>
                      <p className="text-2xl font-bold" style={{ color: "hsl(var(--primary))" }}>{kpi.entrants}</p>
                      <p className="text-xs" style={{ color: "hsl(var(--primary))" }}>Entrants</p>
                    </div>
                    <div className="rounded-xl p-4 text-center" style={{ background: "hsl(var(--warning) / 0.1)" }}>
                      <p className="text-2xl font-bold" style={{ color: "hsl(var(--warning))" }}>{kpi.sortants}</p>
                      <p className="text-xs" style={{ color: "hsl(var(--warning))" }}>Sortants</p>
                    </div>
                  </div>

                  <div className="flex gap-2 px-4 pb-3">
                    <div className="relative flex-1">
                      <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input value={consultationCnssSearch} onChange={e => setConsultationCnssSearch(e.target.value)}
                        placeholder="Rechercher (nom, CIN, matricule)…"
                        className="w-full pl-7 pr-2 py-1.5 rounded-lg border border-border text-sm bg-background" />
                    </div>
                    <select value={consultationCnssFilter} onChange={e => setConsultationCnssFilter(e.target.value)}
                      className="px-2 py-1.5 rounded-lg border border-border text-sm bg-background">
                      <option value="TOUS">Tous les statuts</option>
                      <option value="ACTIF">Actifs</option>
                      <option value="ENTRANT">Entrants</option>
                      <option value="SORTANT">Sortants</option>
                      <option value="ERREUR">En erreur</option>
                    </select>
                  </div>
                </>
              )}

              {consultationCnssLoading ? (
                <p className="text-sm text-center py-8 text-muted-foreground">Chargement…</p>
              ) : consultationCnss.lignes.length === 0 ? (
                <p className="text-sm text-center py-8 text-muted-foreground">Aucune ligne enregistrée pour cette déclaration</p>
              ) : lignesFiltreesConsult.length === 0 ? (
                <p className="text-sm text-center py-8 text-muted-foreground">Aucune ligne ne correspond à ce filtre</p>
              ) : (
                <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Matricule</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">CIN *</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">N°CNSS</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Nom &amp; Prénom</th>
                      <th className="text-right py-2 px-3 font-medium text-muted-foreground">Déclaré</th>
                      <th className="text-right py-2 px-3 font-medium text-muted-foreground">Plafonné (CNSS)</th>
                      <th className="text-center py-2 px-3 font-medium text-muted-foreground">Jours</th>
                      <th className="text-center py-2 px-3 font-medium text-muted-foreground">Statut</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Observations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lignesFiltreesConsult.map((l: any) => (
                      <tr key={l.id} className="border-b border-border">
                        <td className="py-1.5 px-3 font-mono">{l.matricule}</td>
                        <td className="py-1.5 px-3">{l.cin}</td>
                        <td className="py-1.5 px-3">{l.num_cnss || "—"}</td>
                        <td className="py-1.5 px-3 font-medium">{l.nom} {l.prenom}</td>
                        <td className="py-1.5 px-3 text-right font-mono">{Number(l.salaire_brut || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2 })}</td>
                        <td className="py-1.5 px-3 text-right font-mono">{Number(l.salaire_brut || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2 })}</td>
                        <td className="py-1.5 px-3 text-center">{l.nombre_jours}</td>
                        <td className="py-1.5 px-3 text-center">
                          <span className="text-[10px] px-2 py-0.5 rounded font-semibold" style={{
                            background: l.statut_salarie === "ACTIF" ? "hsl(var(--success) / 0.12)"
                              : l.statut_salarie === "ENTRANT" ? "hsl(var(--primary) / 0.1)" : "hsl(var(--warning) / 0.12)",
                            color: l.statut_salarie === "ACTIF" ? "hsl(var(--success))"
                              : l.statut_salarie === "ENTRANT" ? "hsl(var(--primary))" : "hsl(var(--warning))",
                          }}>{l.statut_salarie === "ACTIF" ? "Actif" : l.statut_salarie === "ENTRANT" ? "Entrant" : "Sortant"}</span>
                        </td>
                        <td className="py-1.5 px-3 text-muted-foreground">{l.observations || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground px-4 py-3 border-t border-border">
                "Déclaré" et "Plafonné (CNSS)" affichent la même valeur : seul le montant effectivement soumis au plafond
                CNSS est conservé pour une déclaration verrouillée — le détail avant plafonnement n'est pas historisé.
              </p>
            </div>
          </div>
        );
  }

  // ─── Arrivée depuis le tableau de bord "Vue déclarations" avec une cible ───
  // précise à consulter : panneau de consultation si verrouillée, wizard actif sinon.
  useEffect(() => {
    const cibleId = (location.state as { consulterDeclarationId?: string } | null)?.consulterDeclarationId;
    if (!cibleId) return;
    (async () => {
      const { data, error } = await supabase.from("cnss_declarations" as never)
        .select("*" as never).eq("id" as never, cibleId as never).single();
      if (error || !data) return;
      const decl = data as any as Declaration;
      if (estVerrouilleeCnss(decl.statut)) await ouvrirConsultationCnss(decl);
      else await ouvrirDepuisHistorique(decl);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Historique : chargement + archivage automatique (RG-DECL-CNSS-HIST-01) ───
  // Une déclaration est historisée automatiquement une fois passé le 15 du mois
  // suivant la période déclarée (ex. déclaration de janvier → archivée dès le 16 février).
  const loadHistorique = async () => {
    setHistoriqueLoading(true);
    try {
      const { data, error } = await supabase
        .from("cnss_declarations" as never)
        .select("*" as never)
        .order("annee" as never, { ascending: false } as never)
        .order("mois" as never, { ascending: false } as never);
      if (error) throw error;
      let rows = (data as any[]) || [];

      // Déterminer les déclarations à archiver
      const aujourdHui = new Date();
      const aArchiver = rows.filter((d: any) => {
        if (d.statut === "ARCHIVEE") return false;
        const anneeLimite = d.mois === 12 ? d.annee + 1 : d.annee;
        const moisLimite = d.mois === 12 ? 1 : d.mois + 1;
        const dateLimiteArchivage = new Date(anneeLimite, moisLimite - 1, 15, 23, 59, 59);
        return aujourdHui > dateLimiteArchivage;
      });

      if (aArchiver.length > 0) {
        await Promise.all(aArchiver.map((d: any) =>
          supabase.from("cnss_declarations" as never).update({ statut: "ARCHIVEE" } as never).eq("id" as never, d.id as never)
        ));
        rows = rows.map((d: any) => aArchiver.some((a: any) => a.id === d.id) ? { ...d, statut: "ARCHIVEE" } : d);
      }

      setHistorique(rows as Declaration[]);
    } catch (e: any) {
      toast.error(e.message);
    }
    setHistoriqueLoading(false);
  };

  // ─── Changement manuel de statut (depuis l'historique) ─────────────────
  const changerStatutCnss = async (declId: string, nouveauStatut: CodeStatutDeclaration) => {
    const { error } = await supabase.from("cnss_declarations" as never)
      .update({ statut: nouveauStatut } as never).eq("id" as never, declId as never);
    if (error) { toast.error(error.message); return; }
    setHistorique(prev => prev.map(d => (d as any).id === declId ? { ...d, statut: nouveauStatut } : d));
    toast.success(`Statut mis à jour : ${nouveauStatut}`);
  };

  // RG-DECL-CNSS-BDX : Charger l'identité de la société pour le bordereau de paiement
  useEffect(() => {
    const loadSocieteInfo = async () => {
      try {
        const { data: societes } = await supabase
          .from("societes" as never)
          .select("id, raison_sociale" as never)
          .limit(1);
        const societe = (societes as any[])?.[0];
        if (!societe) return;

        const [{ data: affiliations }, { data: typesAff }] = await Promise.all([
          supabase.from("societe_affiliations" as never).select("*" as never).eq("societe_id" as never, societe.id as never),
          supabase.from("ref_type_affiliation" as never).select("code, libelle" as never),
        ]);

        const typeCnss = ((typesAff as any[]) || []).find((t: any) => (t.libelle || "").toUpperCase().includes("CNSS"));
        const affCnss = ((affiliations as any[]) || []).find((a: any) =>
          typeCnss ? a.code_type_affiliation === typeCnss.code : (a.code_type_affiliation || "").toUpperCase().includes("CNSS")
        );

        setSocieteInfo({
          raisonSociale: societe.raison_sociale || "",
          numAffilieCnss: affCnss?.numero_affiliation || "",
        });
      } catch {
        // Silencieux : le bordereau signalera l'absence d'info au moment de la génération
      }
    };
    loadSocieteInfo();
  }, []);

  useEffect(() => {
    if (viewMode === "historique") loadHistorique();
  }, [viewMode]);

  // ─── Étape 1 : Import fichier préétabli ───
  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const text = await file.text();
      const ext = file.name.split(".").pop()?.toLowerCase();
      let importedLines: DeclarationLigne[] = [];

      if (ext === "xml") {
        // Parse XML préétabli Damancom
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, "text/xml");
        const salaries = xml.querySelectorAll("Salarie, salarie, SALARIE");
        salaries.forEach(s => {
          importedLines.push({
            matricule: s.querySelector("Matricule, matricule")?.textContent || "",
            cin: s.querySelector("CIN, cin, Cin")?.textContent || "",
            num_cnss: s.querySelector("NumCNSS, numcnss, NumCnss, numeroCNSS")?.textContent || "",
            nom: s.querySelector("Nom, nom")?.textContent || "",
            prenom: s.querySelector("Prenom, prenom")?.textContent || "",
            salaire_brut: 0,
            nombre_jours: 0,
            statut_salarie: "ACTIF",
            observations: "",
            est_valide: true,
          });
        });
      } else {
        // CSV / TSV
        const sep = text.includes("\t") ? "\t" : text.includes(";") ? ";" : ",";
        const rows = text.trim().split("\n").map(r => r.split(sep).map(c => c.trim().replace(/^"|"$/g, "")));
        const header = rows[0].map(h => h.toLowerCase());
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (row.length < 3) continue;
          const get = (keys: string[]) => {
            const idx = header.findIndex(h => keys.some(k => h.includes(k)));
            return idx >= 0 ? row[idx] : "";
          };
          importedLines.push({
            matricule: get(["matricule", "mat"]),
            cin: get(["cin", "cine", "carte"]),
            num_cnss: get(["cnss", "immatriculation"]),
            nom: get(["nom", "name"]),
            prenom: get(["prenom", "prénom", "firstname"]),
            salaire_brut: 0,
            nombre_jours: 0,
            statut_salarie: "ACTIF",
            observations: "Importé depuis fichier préétabli",
            est_valide: true,
          });
        }
      }

      if (importedLines.length === 0) {
        toast.error("Aucune ligne détectée dans le fichier");
        setLoading(false);
        return;
      }

      setLignes(importedLines);
      toast.success(`RG-DECL-CNSS-01 : ${importedLines.length} salariés importés depuis le fichier préétabli`);
      setImportMode("file");
    } catch (err: any) {
      toast.error("Erreur de lecture : " + err.message);
    }
    setLoading(false);
    e.target.value = "";
  };

  // ─── Étape 2 : Alimentation automatique ───
  const alimenterAuto = async () => {
    setLoading(true);
    try {
      // RG-DECL-CNSS-02 : Récupérer les collaborateurs actifs avec contrat en cours
      const sfFields = ["salaire_base", "date_debut", "date_fin", "archive"];

      // Charger les collaborateurs actifs avec contrats et salaires fixes
      // (3 requêtes séparées + jointure JS, vu que le backend FastAPI ne gère pas les SELECT imbriqués multi-niveaux)
      const { data: collabsRaw, error } = await supabase
        .from("collaborateurs")
        .select("id, matricule, nom, prenom, cin, num_cnss, statut_collaborateur")
        .eq("archive", false)
        .neq("statut_collaborateur", "SORTI");

      if (error) throw error;
      const collabsList = (collabsRaw as any[]) || [];
      const collabIds = collabsList.map(c => c.id);

      // Récupérer les contrats actifs
      const { data: contratsData } = collabIds.length > 0
        ? await supabase
            .from("collaborateur_contrats")
            .select("collaborateur_id, code_type_contrat, code_statut_contrat, date_debut, date_sortie, archive")
            .in("collaborateur_id", collabIds)
            .eq("archive", false)
        : { data: [] };

      // Récupérer les salaires fixes
      const { data: salairesData } = collabIds.length > 0
        ? await supabase
            .from("collaborateur_salaires_fixes" as never)
            .select(sfFields.join(", ") + ", collaborateur_id")
            .in("collaborateur_id", collabIds)
            .eq("archive", false)
        : { data: [] };

      // Indexer par collaborateur_id
      const contratsByCollab: Record<string, any[]> = {};
      ((contratsData as any[]) || []).forEach((c: any) => {
        if (!contratsByCollab[c.collaborateur_id]) contratsByCollab[c.collaborateur_id] = [];
        contratsByCollab[c.collaborateur_id].push(c);
      });
      const salairesByCollab: Record<string, any[]> = {};
      ((salairesData as any[]) || []).forEach((s: any) => {
        if (!salairesByCollab[s.collaborateur_id]) salairesByCollab[s.collaborateur_id] = [];
        salairesByCollab[s.collaborateur_id].push(s);
      });

      // Assembler les collabs avec leurs relations
      const collabs = collabsList.map(c => ({
        ...c,
        collaborateur_contrats: contratsByCollab[c.id] || [],
        collaborateur_salaires_fixes: salairesByCollab[c.id] || [],
      }));

      const periodeDebut = new Date(annee, mois - 1, 1);
      const periodeFin = new Date(annee, mois, 0);
      const joursOuvres = calculerJoursOuvres(periodeDebut, periodeFin);

      // RG-DECL-CNSS-SOURCE (Option A) : lire salaire brut / nombre de jours depuis le
      // bulletin déjà calculé de la période, sur les rubriques configurées en Paramétrage
      // (ASSIETTE_CNSS, NBJCNSS...). Le proxy /db n'acceptant pas les jointures, on fait
      // bulletin puis bulletin_ligne en deux requêtes séparées.
      const codeRubriqueSalaire = paramsCnss.rubriqueSalaireBrut || null;
      const codeRubriqueJours = paramsCnss.rubriqueNbrJours || null;
      const codesRubriquesBulletin = [codeRubriqueSalaire, codeRubriqueJours].filter(Boolean) as string[];

      const bulletinParCollab: Record<string, { id: string; statut: string }> = {};
      const montantsParCollab: Record<string, Record<string, number>> = {};

      if (collabIds.length > 0) {
        // 1) Retrouver la/les période(s) de calendrier_paie correspondant au mois/année
        const { data: periodesData, error: errPeriodes } = await supabase
          .from("calendrier_paie" as never)
          .select("id, annee, mois" as never)
          .eq("annee" as never, annee as never)
          .eq("mois" as never, mois as never);

        if (errPeriodes) throw errPeriodes;
        const periodeIds = ((periodesData as any[]) || []).map(p => p.id);

        // 2) Bulletins des collaborateurs sur ces périodes
        const { data: bulletinsData, error: errBulletins } = periodeIds.length > 0
          ? await supabase
              .from("bulletin" as never)
              .select("id, collaborateur_id, periode_id, statut" as never)
              .in("collaborateur_id" as never, collabIds as never)
              .in("periode_id" as never, periodeIds as never)
          : { data: [], error: null };

        if (errBulletins) throw errBulletins;

        // Un seul bulletin par collaborateur/période en principe ; en cas de doublon
        // (ex. recalcul), on garde le plus finalisé : CLOTURE > VALIDE > CALCULE
        const prioriteStatut: Record<string, number> = { CLOTURE: 3, VALIDE: 2, CALCULE: 1 };
        ((bulletinsData as any[]) || []).forEach((b: any) => {
          const courant = bulletinParCollab[b.collaborateur_id];
          if (!courant || (prioriteStatut[b.statut] || 0) > (prioriteStatut[courant.statut] || 0)) {
            bulletinParCollab[b.collaborateur_id] = { id: b.id, statut: b.statut };
          }
        });

        // 3) Lignes de bulletin pour les rubriques configurées (montant + nombre)
        const bulletinIds = Object.values(bulletinParCollab).map(b => b.id);
        if (bulletinIds.length > 0 && codesRubriquesBulletin.length > 0) {
          const { data: lignesData, error: errLignes } = await supabase
            .from("bulletin_ligne" as never)
            .select("bulletin_id, code_rubrique, montant, nombre" as never)
            .in("bulletin_id" as never, bulletinIds as never)
            .in("code_rubrique" as never, codesRubriquesBulletin as never);

          if (errLignes) throw errLignes;

          // Salaire brut = montant ; Nombre de jours = nombre (attributs distincts en base)
          const montantsParBulletin: Record<string, Record<string, number>> = {};
          ((lignesData as any[]) || []).forEach((l: any) => {
            if (!montantsParBulletin[l.bulletin_id]) montantsParBulletin[l.bulletin_id] = {};
            if (l.code_rubrique === codeRubriqueJours) {
              montantsParBulletin[l.bulletin_id][l.code_rubrique] = Number(l.nombre) || 0;
            } else {
              montantsParBulletin[l.bulletin_id][l.code_rubrique] = Number(l.montant) || 0;
            }
          });
          Object.entries(bulletinParCollab).forEach(([collabId, b]) => {
            montantsParCollab[collabId] = montantsParBulletin[b.id] || {};
          });
        }
      }

      const newLignesRaw: (DeclarationLigne | null)[] = (collabs || []).map((c: any) => {
        // RG-DECL-CNSS-02e : Exclure les collaborateurs dont AUCUN contrat n'a démarré
        // au plus tard à la fin de la période déclarée — ils n'ont pas encore d'existence
        // sur ce mois (ex. embauche prévue le mois suivant) et ne doivent pas apparaître
        // dans la déclaration, plutôt que d'y figurer avec un salaire à 0.
        const aUnContratDemarre = c.collaborateur_contrats?.some((ct: any) =>
          !ct.archive && new Date(ct.date_debut) <= periodeFin
        );
        if (!aUnContratDemarre) return null;

        // Contrat actif
        const contratActif = c.collaborateur_contrats?.find((ct: any) =>
          !ct.archive && ct.code_statut_contrat !== "CLOTURE" &&
          !ct.date_sortie && new Date(ct.date_debut) <= periodeFin
        );

        // Salaire en cours
        const salaireActif = c.collaborateur_salaires_fixes?.find((s: any) =>
          !s.archive && new Date(s.date_debut) <= periodeFin &&
          (!s.date_fin || new Date(s.date_fin) >= periodeDebut)
        );

        // RG-DECL-CNSS-02 : Statut du salarié
        let statut = "ACTIF";
        if (contratActif && new Date(contratActif.date_debut).getMonth() + 1 === mois &&
            new Date(contratActif.date_debut).getFullYear() === annee) {
          statut = "ENTRANT";
        }
        if (c.statut_collaborateur === "EN_DEPART") {
          statut = "SORTANT";
        }

        const bulletinCollab = bulletinParCollab[c.id];
        const montantsBulletin = montantsParCollab[c.id] || {};
        const bulletinProvisoire = bulletinCollab?.statut === "CALCULE";

        // RG-DECL-CNSS-SOURCE (Option A) : nombre de jours, lu depuis le bulletin réel
        let jours: number;
        let joursSource: "bulletin" | "estime" = "estime";
        if (codeRubriqueJours && montantsBulletin[codeRubriqueJours] != null) {
          jours = Math.min(montantsBulletin[codeRubriqueJours], paramsCnss.plafondJours);
          joursSource = "bulletin";
        } else {
          // Fallback : calcul automatique des jours ouvrés (bulletin absent/rubrique non trouvée)
          jours = Math.min(joursOuvres, paramsCnss.plafondJours);
          if (statut === "ENTRANT" && contratActif) {
            const dateEntree = new Date(contratActif.date_debut);
            jours = Math.min(calculerJoursOuvres(dateEntree, periodeFin), paramsCnss.plafondJours);
          }
        }

        // RG-DECL-CNSS-SOURCE (Option A) : salaire brut, lu depuis le bulletin réel
        let salaireBase: number;
        if (codeRubriqueSalaire && montantsBulletin[codeRubriqueSalaire] != null) {
          salaireBase = montantsBulletin[codeRubriqueSalaire];
        } else {
          // Fallback : salaire_base (bulletin absent/rubrique non trouvée)
          salaireBase = salaireActif?.salaire_base || 0;
        }
        const salairePlafonne = Math.min(salaireBase, paramsCnss.plafondBase);

        const obs: string[] = [];
        if (!c.num_cnss) obs.push("⚠ Pas de N°CNSS");
        if (!bulletinCollab) obs.push("⚠ Aucun bulletin calculé pour cette période – valeurs estimées");
        else if (bulletinProvisoire) obs.push("⚠ Bulletin non validé (CALCULE) – valeurs provisoires");
        if (salaireBase > paramsCnss.plafondBase) obs.push(`Base plafonnée : ${salaireBase.toFixed(2)} → ${salairePlafonne.toFixed(2)}`);
        // Vérification de la rubrique jours réellement utilisée (RG-DECL-CNSS-SOURCE)
        if (codeRubriqueJours) {
          obs.push(joursSource === "bulletin"
            ? `Jours issus du bulletin (rubrique ${codeRubriqueJours})`
            : `⚠ Rubrique jours "${codeRubriqueJours}" introuvable sur le bulletin – jours estimés`);
        }

        return {
          collaborateur_id: c.id,
          matricule: c.matricule,
          cin: c.cin || "",
          num_cnss: c.num_cnss || "",
          nom: c.nom,
          prenom: c.prenom,
          salaire_brut: salairePlafonne,
          salaire_brut_declare: salaireBase,
          nombre_jours: jours,
          statut_salarie: statut,
          observations: obs.join(" | "),
          est_valide: true,
        };
      });
      const newLignes: DeclarationLigne[] = newLignesRaw.filter((l): l is DeclarationLigne => l !== null);

      // Si on avait importé un fichier préétabli, fusionner avec les données réelles
      if (importMode === "file" && lignes.length > 0) {
        // Enrichir les lignes importées avec les salaires/jours réels
        const merged = lignes.map(l => {
          const match = newLignes.find(n =>
            (l.cin && n.cin && l.cin === n.cin) ||
            (l.num_cnss && n.num_cnss && l.num_cnss === n.num_cnss) ||
            (l.matricule && n.matricule && l.matricule === n.matricule)
          );
          if (match) {
            return {
              ...l,
              collaborateur_id: match.collaborateur_id,
              salaire_brut: match.salaire_brut,
              salaire_brut_declare: match.salaire_brut_declare,
              nombre_jours: match.nombre_jours,
              statut_salarie: match.statut_salarie,
              observations: match.observations || l.observations,
            };
          }
          return { ...l, observations: "⚠ Non trouvé dans le système", est_valide: false };
        });
        // Ajouter les nouveaux qui ne sont pas dans le fichier préétabli (entrants)
        const entrants = newLignes.filter(n =>
          !lignes.some(l =>
            (l.cin && n.cin && l.cin === n.cin) ||
            (l.num_cnss && n.num_cnss && l.num_cnss === n.num_cnss)
          ) && n.statut_salarie === "ENTRANT"
        );
        setLignes([...merged, ...entrants.map(e => ({ ...e, observations: "Nouvelle recrue (ENTRANT)" }))]);
      } else {
        setLignes(newLignes);
      }

      toast.success(`RG-DECL-CNSS-02 : ${newLignes.length} collaborateurs alimentés (${joursOuvres} jours ouvrés)`);
    } catch (err: any) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  // ─── Étape 3 : Contrôle de cohérence ───
  const getDeadlineInfo = () => {
    const deadlineDate = new Date(mois === 12 ? annee + 1 : annee, mois === 12 ? 0 : mois, paramsCnss.deadlineJour);
    const now = new Date();
    const diffJours = Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return { deadlineDate, diffJours, isExpired: diffJours < 0 };
  };

  const controler = () => {
    // RG-DECL-CNSS-DEADLINE : Vérification du deadline
    const { diffJours, isExpired } = getDeadlineInfo();
    if (isExpired) {
      toast.warning(`RG-DECL-CNSS-DEADLINE : Deadline dépassé de ${Math.abs(diffJours)} jour(s). La génération sera bloquée.`);
    } else if (diffJours <= 5) {
      toast.warning(`RG-DECL-CNSS-DEADLINE : Attention, il reste ${diffJours} jour(s) avant le deadline.`);
    }
    let erreurs = 0;
    const updated = lignes.map(l => {
      const errs: string[] = [];
      // RG-DECL-CNSS-03 : Contrôle CIN obligatoire
      if (!l.cin || l.cin.trim().length < 4) {
        errs.push("CIN manquante ou invalide");
      }
      // RG-DECL-CNSS-03 : Pas de N°CNSS → statut ENTRANT
      if (!l.num_cnss || l.num_cnss.trim() === "") {
        if (l.statut_salarie !== "ENTRANT") {
          errs.push("N°CNSS manquant – Statut basculé en ENTRANT");
        }
        l.statut_salarie = "ENTRANT";
      }
      // RG-DECL-CNSS-PARAM-02 : Contrôle base plafonnée (0 est autorisé)
      if (l.salaire_brut < 0) {
        errs.push("Salaire brut négatif");
      }
      if (l.salaire_brut > paramsCnss.plafondBase) {
        errs.push(`Salaire (${l.salaire_brut.toFixed(2)}) dépasse le plafond CNSS (${paramsCnss.plafondBase.toFixed(2)})`);
      }
      // RG-DECL-CNSS-PARAM-01 : Contrôle plafond jours (0 est autorisé)
      if (l.nombre_jours < 0 || l.nombre_jours > paramsCnss.plafondJours) {
        errs.push(`Jours (${l.nombre_jours}) hors limite [0-${paramsCnss.plafondJours}]`);
      }
      if (errs.length > 0) erreurs++;
      return {
        ...l,
        est_valide: errs.length === 0,
        erreurs: errs.length > 0 ? errs : undefined,
        observations: errs.length > 0 ? errs.join(" | ") : l.observations
      };
    });
    setLignes(updated);
    if (erreurs === 0) {
      toast.success("RG-DECL-CNSS-03 : Contrôle réussi – Aucune anomalie détectée");
    } else {
      toast.warning(`RG-DECL-CNSS-03 : ${erreurs} anomalie(s) détectée(s) – Veuillez corriger`);
    }
  };

  // ─── Sauvegarder la déclaration en base ───
  const sauvegarder = async (statut: string) => {
    setLoading(true);
    try {
      const totalSalaires = lignes.reduce((s, l) => s + (l.salaire_brut || 0), 0);
      const totalJours = lignes.reduce((s, l) => s + (l.nombre_jours || 0), 0);

      let declId = declaration?.id;
      if (!declId) {
        // RG-DECL-CNSS-04 : Revérifier en base avant d'insérer, au cas où l'état React
        // n'aurait pas été chargé via "Charger" (ex. flux "Créer automatiquement" direct) —
        // évite un INSERT en double sur la contrainte unique (mois, annee).
        const { data: existingArr } = await supabase
          .from("cnss_declarations" as never)
          .select("id" as never)
          .eq("mois" as never, mois as never)
          .eq("annee" as never, annee as never);
        declId = (existingArr as any[])?.[0]?.id;
      }
      if (!declId) {
        const { data, error } = await supabase
          .from("cnss_declarations" as never)
          .insert({
            mois,
            annee,
            statut,
            nombre_lignes: lignes.length,
            total_salaires: totalSalaires,
            total_jours: totalJours,
            created_by: user?.id || null,
          } as never)
          .select("id")
          .single();
        if (error) throw error;
        declId = (data as any).id;
      } else {
        await supabase
          .from("cnss_declarations")
          .update({
            statut,
            nombre_lignes: lignes.length,
            total_salaires: totalSalaires,
            total_jours: totalJours,
          })
          .eq("id", declId);
      }

      // Supprimer les anciennes lignes et insérer les nouvelles
      await supabase.from("cnss_declaration_lignes").delete().eq("declaration_id", declId);

      const rows = lignes.map(l => ({
        declaration_id: declId,
        collaborateur_id: l.collaborateur_id || null,
        matricule: l.matricule,
        cin: l.cin,
        num_cnss: l.num_cnss,
        nom: l.nom,
        prenom: l.prenom,
        salaire_brut: l.salaire_brut,
        nombre_jours: l.nombre_jours,
        statut_salarie: l.statut_salarie,
        observations: l.observations,
        est_valide: l.est_valide,
        erreurs: l.erreurs || null,
      }));

      // Insérer par lots de 100
      for (let i = 0; i < rows.length; i += 100) {
        const { error } = await supabase.from("cnss_declaration_lignes").insert(rows.slice(i, i + 100));
        if (error) throw error;
      }

      setDeclaration({ id: declId, mois, annee, statut, nombre_lignes: lignes.length, total_salaires: totalSalaires, total_jours: totalJours });
      toast.success(`Déclaration sauvegardée (${statut})`);
    } catch (err: any) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  // ─── Étape 4 : Générer XML Damancom ───
  const genererXML = () => {
    const lignesValides = lignes.filter(l => l.est_valide);
    if (lignesValides.length === 0) {
      toast.error("Aucune ligne valide pour générer le XML");
      return;
    }

    // RG-DECL-CNSS-DEADLINE : Bloquer la génération si deadline dépassé
    const { isExpired, diffJours } = getDeadlineInfo();
    if (isExpired) {
      const forcer = confirm(`⚠ Le deadline est dépassé de ${Math.abs(diffJours)} jour(s).\nVoulez-vous forcer la génération malgré le retard ?`);
      if (!forcer) return;
    }

    const totalSalaires = lignesValides.reduce((s, l) => s + l.salaire_brut, 0);
    const totalJours = lignesValides.reduce((s, l) => s + l.nombre_jours, 0);

    // RG-DECL-CNSS-04 : Format XML Damancom standard
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<DeclarationCNSS>\n`;
    xml += `  <Entete>\n`;
    xml += `    <Mois>${String(mois).padStart(2, "0")}</Mois>\n`;
    xml += `    <Annee>${annee}</Annee>\n`;
    xml += `    <NombreSalaries>${lignesValides.length}</NombreSalaries>\n`;
    xml += `    <TotalSalaires>${totalSalaires.toFixed(2)}</TotalSalaires>\n`;
    xml += `    <TotalJours>${totalJours}</TotalJours>\n`;
    xml += `    <DateGeneration>${new Date().toISOString().split("T")[0]}</DateGeneration>\n`;
    xml += `  </Entete>\n`;
    xml += `  <Salaries>\n`;

    lignesValides.forEach(l => {
      xml += `    <Salarie>\n`;
      xml += `      <NumCNSS>${escapeXml(l.num_cnss)}</NumCNSS>\n`;
      xml += `      <CIN>${escapeXml(l.cin)}</CIN>\n`;
      xml += `      <Nom>${escapeXml(l.nom)}</Nom>\n`;
      xml += `      <Prenom>${escapeXml(l.prenom)}</Prenom>\n`;
      xml += `      <Matricule>${escapeXml(l.matricule)}</Matricule>\n`;
      xml += `      <SalaireBrut>${l.salaire_brut.toFixed(2)}</SalaireBrut>\n`;
      xml += `      <NombreJours>${l.nombre_jours}</NombreJours>\n`;
      xml += `      <StatutSalarie>${l.statut_salarie}</StatutSalarie>\n`;
      xml += `    </Salarie>\n`;
    });

    xml += `  </Salaries>\n`;
    xml += `</DeclarationCNSS>`;

    // Télécharger
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `CNSS_${annee}_${String(mois).padStart(2, "0")}.xml`;
    a.click();
    URL.revokeObjectURL(url);

    if (!consultationMode) {
      sauvegarder("GENEREE");
    }
    toast.success(`RG-DECL-CNSS-04 : Fichier XML généré (${lignesValides.length} salariés)`);
  };

  // ─── Bordereau de paiement CNSS (Régime Général + AMO) — généré côté backend
  // (xhtml2pdf, bilingue FR/AR) via /paie/rapports/cnss/bordereau ───
  const genererBordereauPDF = async (lignesArg?: DeclarationLigne[], moisArg?: number, anneeArg?: number) => {
    const lignesCible = lignesArg ?? lignes;
    const moisCible = moisArg ?? mois;
    const anneeCible = anneeArg ?? annee;

    if (lignesCible.length === 0) {
      toast.error("Aucune ligne à déclarer pour cette période — impossible de générer le bordereau");
      return;
    }

    const assiettePlafonnee = lignesCible.reduce((s, l) => s + l.salaire_brut, 0);
    const assietteNonPlafonnee = lignesCible.reduce((s, l) => s + (l.salaire_brut_declare ?? l.salaire_brut), 0);

    try {
      const blob = await postForBlob("/paie/rapports/cnss/bordereau", {
        mois: moisCible,
        annee: anneeCible,
        assiette_plafonnee: assiettePlafonnee,
        assiette_non_plafonnee: assietteNonPlafonnee,
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Bordereau_CNSS_${anneeCible}_${String(moisCible).padStart(2, "0")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Bordereau de paiement CNSS généré (Régime Général + AMO)");
    } catch (e: any) {
      toast.error(e.message || "Échec de la génération du bordereau");
    }
  };


  const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const calculerJoursOuvres = (debut: Date, fin: Date): number => {
    let jours = 0;
    const d = new Date(debut);
    while (d <= fin) {
      const day = d.getDay();
      if (day !== 0) jours++; // Dimanche exclu
      d.setDate(d.getDate() + 1);
    }
    return Math.min(jours, paramsCnss.plafondJours);
  };

  const filteredLignes = lignes.filter(l => {
    const matchSearch = !searchTerm ||
      l.nom.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.prenom.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.cin.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.matricule.toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatut = filterStatut === "TOUS" || l.statut_salarie === filterStatut;
    return matchSearch && matchStatut;
  });

  const stats = {
    total: lignes.length,
    actifs: lignes.filter(l => l.statut_salarie === "ACTIF").length,
    entrants: lignes.filter(l => l.statut_salarie === "ENTRANT").length,
    sortants: lignes.filter(l => l.statut_salarie === "SORTANT").length,
    erreurs: lignes.filter(l => !l.est_valide).length,
    sansCnss: lignes.filter(l => !l.num_cnss).length,
    totalSalaires: lignes.reduce((s, l) => s + l.salaire_brut, 0),
    totalSalairesDeclare: lignes.reduce((s, l) => s + (l.salaire_brut_declare ?? l.salaire_brut), 0),
    totalJours: lignes.reduce((s, l) => s + (l.nombre_jours || 0), 0),
    totalJoursEntrants: lignes.filter(l => l.statut_salarie === "ENTRANT").reduce((s, l) => s + (l.nombre_jours || 0), 0),
    totalSalairesDeclareEntrants: lignes.filter(l => l.statut_salarie === "ENTRANT").reduce((s, l) => s + (l.salaire_brut_declare ?? l.salaire_brut), 0),
  };

  const steps = [
    { num: 0, label: "Paramétrage", icon: <Settings size={16} /> },
    { num: 1, label: "Fichier préétabli", icon: <Upload size={16} /> },
    { num: 2, label: "Alimentation", icon: <RefreshCw size={16} /> },
    { num: 3, label: "Contrôle", icon: <CheckCircle2 size={16} /> },
    { num: 4, label: "Génération XML", icon: <Download size={16} /> },
  ];

  const STATUT_BADGE: Record<string, string> = {
    GENEREE: "bg-emerald-500/10 text-emerald-600",
    CONTROLEE: "bg-blue-500/10 text-blue-600",
    ARCHIVEE: "bg-slate-500/10 text-slate-600",
  };

  // ─── Mode Historique des déclarations (RG-DECL-CNSS-HIST) ───
  if (viewMode === "historique") {
    return (
      <div className="p-4 md:p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 rounded-xl bg-accent/10">
            <Shield size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Déclaration CNSS</h1>
            <p className="text-xs text-muted-foreground">Historique des déclarations</p>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-6 pb-3 border-b border-border">
          <button
            onClick={() => setViewMode("wizard")}
            className="px-4 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-all"
          >
            Déclaration en cours
          </button>
          <button
            onClick={() => setViewMode("historique")}
            className="px-4 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground shadow transition-all"
          >
            Historique
          </button>
        </div>

        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {historiqueLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Chargement…</div>
          ) : historique.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Aucune déclaration enregistrée</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Période</th>
                  <th className="px-3 py-2 text-center font-medium text-muted-foreground">Statut</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Salariés</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Total salaires</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Total jours</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Créée le</th>
                  <th className="px-3 py-2 text-center font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {historique.map((d, idx) => (
                  <tr key={d.id || idx} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{MOIS_LABELS[d.mois]} {d.annee}</td>
                    <td className="px-3 py-2 text-center">
                      <StatutSelector code={d.statut} onChange={(nouveau) => changerStatutCnss(d.id!, nouveau)} />
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{d.nombre_lignes}</td>
                    <td className="px-3 py-2 text-right font-mono">{(d.total_salaires || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-right font-mono">{d.total_jours}</td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">
                      {d.created_at ? new Date(d.created_at).toLocaleDateString("fr-FR") : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => estVerrouilleeCnss(d.statut) ? ouvrirConsultationCnss(d) : ouvrirDepuisHistorique(d)}
                          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded font-semibold"
                          style={estVerrouilleeCnss(d.statut)
                            ? { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }
                            : { background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}
                        >
                          {estVerrouilleeCnss(d.statut) ? <Eye size={12} /> : <Pencil size={12} />}
                          {estVerrouilleeCnss(d.statut) ? "Consulter" : "Ouvrir"}
                        </button>
                        <button
                          onClick={async () => {
                            const { data: l, error } = await supabase
                              .from("cnss_declaration_lignes" as never)
                              .select("*" as never)
                              .eq("declaration_id" as never, d.id as never);
                            if (error) { toast.error(error.message); return; }
                            genererBordereauPDF((l || []) as any, d.mois, d.annee);
                            // Navigation vers l'écran de consultation (n'affecte pas le PDF déjà généré)
                            if (estVerrouilleeCnss(d.statut)) await ouvrirConsultationCnss(d);
                            else await ouvrirDepuisHistorique(d);
                          }}
                          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded font-semibold"
                          style={{ background: "hsl(var(--accent) / 0.1)", color: "hsl(var(--accent))" }}
                        >
                          <Download size={12} /> Bordereau
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-4 rounded-xl border border-border bg-blue-500/5 p-4 text-xs text-muted-foreground">
          <strong className="text-foreground">RG-DECL-CNSS-HIST-01</strong> : une déclaration est automatiquement
          archivée dès le 16 du mois suivant la fin de la période déclarée (ex. déclaration de janvier →
          archivée à partir du 16 février).
        </div>

        {renderConsultationCnss()}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-accent/10">
            <Shield size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Déclaration CNSS</h1>
            <p className="text-xs text-muted-foreground">
              Paramétrage → Import → Alimentation → Contrôle → Génération XML
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-6 pb-3 border-b border-border">
        <button
          onClick={() => { setViewMode("wizard"); setConsultationMode(false); }}
          className="px-4 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground shadow transition-all"
        >
          Déclaration en cours
        </button>
        <button
          onClick={() => setViewMode("historique")}
          className="px-4 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-all"
        >
          🗂 Historique
        </button>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-1 mb-5 overflow-x-auto pb-2">
        {steps.map((s, i) => (
          <React.Fragment key={s.num}>
            <button
              onClick={() => setStep(s.num)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                step === s.num
                  ? "bg-primary text-primary-foreground shadow"
                  : step > s.num
                  ? "bg-emerald-500/10 text-emerald-600"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {step > s.num ? <CheckCircle2 size={14} /> : s.icon}
              <span className="hidden sm:inline">{s.label}</span>
              <span className="sm:hidden">{s.num}</span>
            </button>
            {i < steps.length - 1 && <ArrowRight size={14} className="text-muted-foreground flex-shrink-0" />}
          </React.Fragment>
        ))}
      </div>

      {/* Résumé paramètres (compact, visible sur toutes les étapes sauf paramétrage) */}
      {paramsLoaded && step !== 0 && (
        <div className="flex flex-wrap gap-2 mb-4 px-1">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-full">
            <Shield size={10} className="text-primary" /> {paramsCnss.plafondJours}j / {paramsCnss.plafondBase.toLocaleString("fr-FR")} MAD
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-full">
            Tx sal. {paramsCnss.tauxSalarial}% | pat. {paramsCnss.tauxPatronal}%
          </div>
          {(() => {
            const deadlineDate = new Date(mois === 12 ? annee + 1 : annee, mois === 12 ? 0 : mois, paramsCnss.deadlineJour);
            const diffJours = Math.ceil((deadlineDate.getTime() - Date.now()) / 86400000);
            const isExpired = diffJours < 0;
            const isUrgent = diffJours >= 0 && diffJours <= 5;
            return (
              <div className={`flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full font-medium ${
                isExpired ? "bg-destructive/15 text-destructive" : isUrgent ? "bg-amber-500/15 text-amber-600" : "bg-emerald-500/10 text-emerald-600"
              }`}>
                {isExpired ? "⛔" : "📅"} J{isExpired ? diffJours : `+${diffJours}`}
              </div>
            );
          })()}
          <button onClick={() => setStep(0)} className="text-[11px] text-primary hover:underline ml-1">⚙ Paramétrage</button>
        </div>
      )}

      {/* ═══ ÉTAPE 0 : Paramétrage CNSS ═══ */}
      {step === 0 && (
        <div className="space-y-4">
          {/* Plafonds et taux */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Shield size={16} className="text-primary" />
              Plafonds et taux CNSS
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">Plafond jours déclarés</label>
                <input type="number" defaultValue={paramsCnss.plafondJours}
                  onBlur={e => saveParamCnss("CNSS_PLAFOND_JOURS", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">Plafond base (MAD)</label>
                <input type="number" defaultValue={paramsCnss.plafondBase}
                  onBlur={e => saveParamCnss("CNSS_PLAFOND_BASE", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">Jour deadline mensuel</label>
                <input type="number" min={1} max={28} defaultValue={paramsCnss.deadlineJour}
                  onBlur={e => saveParamCnss("CNSS_DEADLINE_JOUR", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">Taux salarial (%)</label>
                <input type="number" step="0.01" defaultValue={paramsCnss.tauxSalarial}
                  onBlur={e => saveParamCnss("CNSS_TAUX_SALARIAL", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">Taux patronal (%)</label>
                <input type="number" step="0.01" defaultValue={paramsCnss.tauxPatronal}
                  onBlur={e => saveParamCnss("CNSS_TAUX_PATRONAL", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm" />
              </div>
            </div>
          </div>

          {/* Sources de données */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Info size={16} className="text-primary" />
              Sources de données
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              RG-DECL-CNSS-SOURCE : Sélectionnez la rubrique, l'attribut (Nombre, Taux, Montant) et le type de récupération pour chaque donnée.
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Source Salaire Brut */}
              <div className="space-y-3 p-4 rounded-xl border border-border bg-muted/20">
                <p className="text-xs font-semibold text-foreground">📊 Salaire brut</p>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Rubrique</label>
                  <select value={paramsCnss.rubriqueSalaireBrut}
                    onChange={e => { saveSourceRubrique("CNSS_RUBRIQUE_SALAIRE_BRUT", e.target.value); setSalaireSrcAttribut(""); setSalaireSrcType(""); }}
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-xs">
                    <option value="">— salaire_base (par défaut) —</option>
                    {rubriquesDisponibles.map(r => (
                      <option key={r.code} value={r.code}>
                        {r.code} – {r.libelle}{r.code_type ? ` [${r.code_type}]` : ""}{r.zone_fixe_key ? ` (${r.zone_fixe_key})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                {paramsCnss.rubriqueSalaireBrut && (() => {
                  const rub = rubriquesDisponibles.find(r => r.code === paramsCnss.rubriqueSalaireBrut);
                  const attrs = rub?.alimentations || [];
                  const uniqueAttrs = [...new Set(attrs.map(a => a.code_attribut))];
                  const uniqueTypes = [...new Set(attrs.map(a => a.source_type))];
                  return (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[11px] text-muted-foreground mb-1 block">Attribut</label>
                          <select value={salaireSrcAttribut} onChange={e => setSalaireSrcAttribut(e.target.value)}
                            className="w-full px-2 py-1.5 rounded-lg border border-input bg-background text-xs">
                            <option value="">—</option>
                            {ATTRIBUTS_STANDARD.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[11px] text-muted-foreground mb-1 block">Type</label>
                          <select value={salaireSrcType} onChange={e => setSalaireSrcType(e.target.value)}
                            className="w-full px-2 py-1.5 rounded-lg border border-input bg-background text-xs">
                            <option value="">—</option>
                            {TYPES_SOURCE_STANDARD.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
                          </select>
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        ℹ La valeur sera lue sur le bulletin calculé/validé de la période (ligne {rub?.code}). Si aucun bulletin n'existe pour un collaborateur, le salaire_base sera utilisé en repli.
                      </p>
                      {attrs.length === 0 && (
                        <p className="text-[11px] text-muted-foreground mt-1">Aucune alimentation configurée pour cette rubrique.</p>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* Source Nombre de jours */}
              <div className="space-y-3 p-4 rounded-xl border border-border bg-muted/20">
                <p className="text-xs font-semibold text-foreground">📅 Nombre de jours</p>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Rubrique</label>
                  <select value={paramsCnss.rubriqueNbrJours}
                    onChange={e => { saveSourceRubrique("CNSS_RUBRIQUE_NBR_JOURS", e.target.value); setJoursSrcAttribut(""); setJoursSrcType(""); }}
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-xs">
                    <option value="">— Jours ouvrés calculés (par défaut) —</option>
                    {rubriquesDisponibles.map(r => (
                      <option key={r.code} value={r.code}>
                        {r.code} – {r.libelle}{r.code_type ? ` [${r.code_type}]` : ""}{r.zone_fixe_key ? ` (${r.zone_fixe_key})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                {paramsCnss.rubriqueNbrJours && (() => {
                  const rub = rubriquesDisponibles.find(r => r.code === paramsCnss.rubriqueNbrJours);
                  const attrs = rub?.alimentations || [];
                  const uniqueAttrs = [...new Set(attrs.map(a => a.code_attribut))];
                  const uniqueTypes = [...new Set(attrs.map(a => a.source_type))];
                  return (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[11px] text-muted-foreground mb-1 block">Attribut</label>
                          <select value={joursSrcAttribut} onChange={e => setJoursSrcAttribut(e.target.value)}
                            className="w-full px-2 py-1.5 rounded-lg border border-input bg-background text-xs">
                            <option value="">—</option>
                            {ATTRIBUTS_STANDARD.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[11px] text-muted-foreground mb-1 block">Type</label>
                          <select value={joursSrcType} onChange={e => setJoursSrcType(e.target.value)}
                            className="w-full px-2 py-1.5 rounded-lg border border-input bg-background text-xs">
                            <option value="">—</option>
                            {TYPES_SOURCE_STANDARD.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
                          </select>
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        ℹ La valeur sera lue sur le bulletin calculé/validé de la période (ligne {rub?.code}). Si aucun bulletin n'existe pour un collaborateur, les jours ouvrés seront calculés en repli.
                      </p>
                      {attrs.length === 0 && (
                        <p className="text-[11px] text-muted-foreground mt-1">Aucune alimentation configurée pour cette rubrique.</p>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Statuts CNSS */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Users size={16} className="text-primary" />
              Statuts des salariés CNSS
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                 <thead>
<tr className="bg-muted/40 border-b border-border">
                     <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Code</th>
                     <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Libellé</th>
                     <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Description</th>
                   </tr>
                 </thead>
                 <tbody>
                   {statutsCnss.map(s => (
                     <tr key={s.code} className="border-b border-border">
                       <td className="px-3 py-2 font-mono text-xs text-accent font-semibold">{s.code}</td>
                       <td className="px-3 py-2 text-foreground">{s.libelle}</td>
                       <td className="px-3 py-2 text-xs text-muted-foreground">{s.description || "—"}</td>
                     </tr>
                   ))}
                 </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Les statuts sont gérés via le référentiel des statuts CNSS (Référentiels → Paie & Rémunération).
            </p>
          </div>

          <div className="flex justify-end">
            <button onClick={() => setStep(1)}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2">
              Commencer la déclaration <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ═══ ÉTAPE 1 : Fichier préétabli ═══ */}
      {step === 1 && (
        <div className="space-y-4">
          {/* Sélection période */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Calendar size={16} className="text-primary" />
              Période de déclaration
            </h3>
            <div className="flex flex-wrap gap-3">
              <select
                value={mois}
                onChange={e => setMois(Number(e.target.value))}
                className="px-3 py-2 rounded-lg border border-input bg-background text-sm"
              >
                {MOIS_LABELS.slice(1).map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
              <input
                type="number"
                value={annee}
                onChange={e => setAnnee(Number(e.target.value))}
                min={2020} max={2099}
                className="px-3 py-2 rounded-lg border border-input bg-background text-sm w-24"
              />
              <button
                onClick={initDeclaration}
                disabled={loading}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 flex items-center gap-2"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                Charger
              </button>
            </div>
            {declaration && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-700 text-xs flex items-center gap-2">
                <CheckCircle2 size={14} />
                Déclaration existante : {declaration.nombre_lignes} lignes – Statut : {declaration.statut}
              </div>
            )}
          </div>

          {/* Import fichier ou création auto */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-border bg-card p-5 hover:border-primary/30 transition-colors">
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <FileUp size={16} className="text-blue-600" />
                Importer le fichier préétabli
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                RG-DECL-CNSS-01 : Chargez le fichier CSV/Excel ou XML téléchargé depuis le portail Damancom.
              </p>
              <label className="flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 cursor-pointer hover:bg-primary/10 transition-colors text-sm font-medium text-primary">
                <Upload size={16} />
                Sélectionner un fichier
                <input
                  type="file"
                  accept=".csv,.txt,.xml,.xls,.xlsx"
                  onChange={handleFileImport}
                  className="hidden"
                />
              </label>
              {importMode === "file" && lignes.length > 0 && (
                <p className="mt-2 text-xs text-emerald-600">✓ {lignes.length} lignes importées</p>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-card p-5 hover:border-primary/30 transition-colors">
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Users size={16} className="text-violet-600" />
                Créer depuis les données système
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                Générer automatiquement la liste des salariés à déclarer à partir de la base collaborateurs.
              </p>
              <button
                onClick={() => { setImportMode("auto"); setStep(2); }}
                className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 flex items-center gap-2"
              >
                <RefreshCw size={14} />
                Créer automatiquement
              </button>
            </div>
          </div>

          {/* Règles de gestion */}
          <div className="rounded-xl border border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-800 p-4">
            <h4 className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-2 flex items-center gap-2">
              <Info size={14} /> Règles de gestion – Étape 1
            </h4>
            <ul className="text-xs text-blue-600 dark:text-blue-300 space-y-1 list-disc pl-4">
              <li><strong>RG-DECL-CNSS-01</strong> : Le fichier préétabli contient la liste des salariés telle que connue par la CNSS.</li>
              <li>Formats acceptés : CSV (séparateurs ; ou ,), TSV et XML Damancom.</li>
              <li>Si aucun fichier n'est importé, la déclaration est créée à partir des données internes.</li>
            </ul>
          </div>

          {lignes.length > 0 && (
            <div className="flex justify-end">
              <button
                onClick={() => setStep(2)}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2"
              >
                Étape suivante <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ═══ ÉTAPE 2 : Alimentation automatique ═══ */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <RefreshCw size={16} className="text-primary" />
                Alimentation des salaires et jours – {MOIS_LABELS[mois]} {annee}
              </h3>
              <button
                onClick={alimenterAuto}
                disabled={loading}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 hover:opacity-90"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Alimenter automatiquement
              </button>
            </div>

            {/* KPIs */}
            {lignes.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="rounded-xl bg-muted/50 p-3 text-center">
                  <p className="text-lg font-bold text-foreground">{stats.total}</p>
                  <p className="text-xs text-muted-foreground">Salariés</p>
                </div>
                <div className="rounded-xl bg-emerald-500/10 p-3 text-center">
                  <p className="text-lg font-bold text-emerald-600">{stats.actifs}</p>
                  <p className="text-xs text-muted-foreground">Actifs</p>
                </div>
                <div className="rounded-xl bg-blue-500/10 p-3 text-center">
                  <p className="text-lg font-bold text-blue-600">{stats.entrants}</p>
                  <p className="text-xs text-muted-foreground">Entrants</p>
                </div>
                <div className="rounded-xl bg-amber-500/10 p-3 text-center">
                  <p className="text-lg font-bold text-amber-600">{stats.sortants}</p>
                  <p className="text-xs text-muted-foreground">Sortants</p>
                </div>
              </div>
            )}

            {/* Tableau */}
            {lignes.length > 0 && renderTable()}
          </div>

          {/* Règles */}
          <div className="rounded-xl border border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-800 p-4">
            <h4 className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-2 flex items-center gap-2">
              <Info size={14} /> Règles de gestion – Étape 2
            </h4>
            <ul className="text-xs text-blue-600 dark:text-blue-300 space-y-1 list-disc pl-4">
              <li><strong>RG-DECL-CNSS-02a</strong> : Le salaire brut est récupéré depuis le dernier salaire fixe actif.</li>
              <li><strong>RG-DECL-CNSS-02b</strong> : Le nombre de jours est calculé automatiquement (jours ouvrés, plafond 26j CNSS).</li>
              <li><strong>RG-DECL-CNSS-02c</strong> : Les nouvelles recrues du mois sont marquées ENTRANT avec jours au prorata.</li>
              <li><strong>RG-DECL-CNSS-02d</strong> : Les collaborateurs EN_DEPART sont marqués SORTANT.</li>
            </ul>
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="px-4 py-2 rounded-lg border border-border text-sm flex items-center gap-2">
              <ArrowLeft size={14} /> Retour
            </button>
            <button
              onClick={() => { if (lignes.length > 0) setStep(3); else toast.error("Veuillez alimenter les données"); }}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2"
            >
              Étape suivante <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ═══ ÉTAPE 3 : Contrôle ═══ */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <CheckCircle2 size={16} className="text-primary" />
                Contrôle de cohérence
              </h3>
              {consultationMode ? (
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1.5 rounded-full bg-slate-500/10 text-slate-600 text-xs font-medium flex items-center gap-1.5">
                    🔒 Mode consultation — déclaration {declaration?.statut === "TRAITEE" ? "traitée" : "archivée"}
                  </span>
                  <button
                    onClick={() => navigate(-1)}
                    className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-muted flex items-center gap-1.5"
                  >
                    ← Retour
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={controler}
                    className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium flex items-center gap-2 hover:bg-amber-700"
                  >
                    <CheckCircle2 size={14} /> Lancer le contrôle
                  </button>
                  <button
                    onClick={() => sauvegarder("CONTROLEE")}
                    disabled={loading || stats.erreurs > 0}
                    className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium flex items-center gap-2 hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {loading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    Valider et sauvegarder
                  </button>
                </div>
              )}
            </div>

            {/* KPIs contrôle */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
              <div className="rounded-xl bg-muted/50 p-3 text-center">
                <p className="text-lg font-bold text-foreground">{stats.total}</p>
                <p className="text-xs text-muted-foreground">Total lignes</p>
              </div>
              <div className="rounded-xl bg-blue-500/10 p-3 text-center">
                <p className="text-lg font-bold text-blue-600">{stats.entrants}</p>
                <p className="text-xs text-muted-foreground">Entrants</p>
                {stats.entrants > 0 && (
                  <p className="text-[10px] text-blue-600/80 mt-1">
                    {stats.totalJoursEntrants} j · {stats.totalSalairesDeclareEntrants.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} MAD
                  </p>
                )}
              </div>
              <div className="rounded-xl bg-red-500/10 p-3 text-center">
                <p className="text-lg font-bold text-red-600">{stats.erreurs}</p>
                <p className="text-xs text-muted-foreground">Erreurs</p>
              </div>
              <div className="rounded-xl bg-amber-500/10 p-3 text-center">
                <p className="text-lg font-bold text-amber-600">{stats.sansCnss}</p>
                <p className="text-xs text-muted-foreground">Sans N°CNSS</p>
              </div>
              <div className="rounded-xl bg-sky-500/10 p-3 text-center">
                <p className="text-lg font-bold text-sky-600">{stats.totalJours}</p>
                <p className="text-xs text-muted-foreground">Jours déclarés</p>
              </div>
              <div className="rounded-xl bg-muted/50 p-3 text-center">
                <p className="text-lg font-bold text-foreground">
                  {stats.totalSalairesDeclare.toLocaleString("fr-FR", { minimumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-muted-foreground">Montant déclaré (MAD)</p>
              </div>
              <div className="rounded-xl bg-emerald-500/10 p-3 text-center">
                <p className="text-lg font-bold text-emerald-600">
                  {stats.totalSalaires.toLocaleString("fr-FR", { minimumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-muted-foreground">Total salaires plafonnés (MAD)</p>
              </div>
            </div>

            {/* Filtres */}
            <div className="flex flex-wrap gap-2 mb-3">
              <div className="relative flex-1 min-w-[180px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Rechercher (nom, CIN, matricule)…"
                  className="w-full pl-8 pr-3 py-2 rounded-lg border border-input bg-background text-sm"
                />
              </div>
              <select
                value={filterStatut}
                onChange={e => setFilterStatut(e.target.value)}
                className="px-3 py-2 rounded-lg border border-input bg-background text-sm"
              >
                <option value="TOUS">Tous les statuts</option>
                {statutsCnss.map(s => (
                  <option key={s.code} value={s.code}>{s.libelle}</option>
                ))}
              </select>
            </div>

            {renderTable()}
          </div>

          {/* Règles */}
          <div className="rounded-xl border border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-800 p-4">
            <h4 className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-2 flex items-center gap-2">
              <Info size={14} /> Règles de gestion – Étape 3
            </h4>
            <ul className="text-xs text-blue-600 dark:text-blue-300 space-y-1 list-disc pl-4">
              <li><strong>RG-DECL-CNSS-03a</strong> : La CIN est obligatoire et vérifiée pour chaque salarié.</li>
              <li><strong>RG-DECL-CNSS-03b</strong> : Les collaborateurs sans N°CNSS sont automatiquement basculés en statut ENTRANT.</li>
              <li><strong>RG-DECL-CNSS-03c</strong> : Le salaire brut doit être strictement positif.</li>
              <li><strong>RG-DECL-CNSS-03d</strong> : Le nombre de jours doit être compris entre 1 et 26 (plafond CNSS).</li>
            </ul>
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep(2)} className="px-4 py-2 rounded-lg border border-border text-sm flex items-center gap-2">
              <ArrowLeft size={14} /> Retour
            </button>
            <button
              onClick={() => { if (stats.erreurs === 0) setStep(4); else toast.error("Corrigez les erreurs avant de continuer"); }}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2"
            >
              Étape suivante <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ═══ ÉTAPE 4 : Génération XML ═══ */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Download size={16} className="text-primary" />
              Génération du fichier XML – Format Damancom
            </h3>

            {/* Récapitulatif */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <div className="rounded-xl bg-muted/50 p-3 text-center">
                <p className="text-lg font-bold text-foreground">{MOIS_LABELS[mois]} {annee}</p>
                <p className="text-xs text-muted-foreground">Période</p>
              </div>
              <div className="rounded-xl bg-emerald-500/10 p-3 text-center">
                <p className="text-lg font-bold text-emerald-600">{lignes.filter(l => l.est_valide).length}</p>
                <p className="text-xs text-muted-foreground">Salariés déclarés</p>
              </div>
              <div className="rounded-xl bg-blue-500/10 p-3 text-center">
                <p className="text-lg font-bold text-blue-600">
                  {stats.totalSalaires.toLocaleString("fr-FR", { minimumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-muted-foreground">Total salaires (MAD)</p>
              </div>
              <div className="rounded-xl bg-violet-500/10 p-3 text-center">
                <p className="text-lg font-bold text-violet-600">
                  {lignes.reduce((s, l) => s + l.nombre_jours, 0)}
                </p>
                <p className="text-xs text-muted-foreground">Total jours</p>
              </div>
            </div>

            {/* Aperçu XML */}
            <div className="rounded-xl border border-border bg-muted/30 p-4 mb-4 max-h-48 overflow-y-auto">
              <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">
{`<?xml version="1.0" encoding="UTF-8"?>
<DeclarationCNSS>
  <Entete>
    <Mois>${String(mois).padStart(2, "0")}</Mois>
    <Annee>${annee}</Annee>
    <NombreSalaries>${lignes.filter(l => l.est_valide).length}</NombreSalaries>
    ...
  </Entete>
  <Salaries>
    ${lignes.filter(l => l.est_valide).slice(0, 3).map(l => `<Salarie>
      <NumCNSS>${l.num_cnss}</NumCNSS>
      <CIN>${l.cin}</CIN>
      <Nom>${l.nom}</Nom>
      <SalaireBrut>${l.salaire_brut.toFixed(2)}</SalaireBrut>
      <NombreJours>${l.nombre_jours}</NombreJours>
    </Salarie>`).join("\n    ")}
    ${lignes.filter(l => l.est_valide).length > 3 ? `... (${lignes.filter(l => l.est_valide).length - 3} autres)` : ""}
  </Salaries>
</DeclarationCNSS>`}
              </pre>
            </div>

            <div className="flex gap-2">
              <button
                onClick={genererXML}
                disabled={loading}
                className="flex-1 px-4 py-3 rounded-lg bg-emerald-600 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-emerald-700"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                Télécharger le fichier XML
              </button>
              <button
                onClick={() => genererBordereauPDF()}
                className="flex-1 px-4 py-3 rounded-lg border border-primary text-primary text-sm font-semibold flex items-center justify-center gap-2 hover:bg-primary/5"
              >
                <FileUp size={16} className="rotate-180" />
                Bordereau de paiement (PDF)
              </button>
            </div>
          </div>

          {/* Règles */}
          <div className="rounded-xl border border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-800 p-4">
            <h4 className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-2 flex items-center gap-2">
              <Info size={14} /> Règles de gestion – Étape 4
            </h4>
            <ul className="text-xs text-blue-600 dark:text-blue-300 space-y-1 list-disc pl-4">
              <li><strong>RG-DECL-CNSS-04a</strong> : Seules les lignes valides (contrôle passé) sont incluses dans le XML.</li>
              <li><strong>RG-DECL-CNSS-04b</strong> : Le format respecte la structure Damancom (balises normalisées).</li>
              <li><strong>RG-DECL-CNSS-04c</strong> : Le fichier est nommé CNSS_AAAA_MM.xml.</li>
              <li><strong>RG-DECL-CNSS-04d</strong> : La déclaration est sauvegardée avec le statut GENEREE après téléchargement.</li>
              <li><strong>RG-DECL-CNSS-BDX-01</strong> : Le bordereau de paiement applique le plafond CNSS uniquement sur la ligne « Prestations sociales » ; AF, TFP et AMO se calculent sur la masse salariale non plafonnée.</li>
            </ul>
          </div>

          <div className="flex justify-start">
            <button onClick={() => setStep(3)} className="px-4 py-2 rounded-lg border border-border text-sm flex items-center gap-2">
              <ArrowLeft size={14} /> Retour au contrôle
            </button>
          </div>
        </div>
      )}

      {/* ─── Consultation en lecture seule (Traité / Archivé) — panneau indépendant du wizard ─── */}
      {renderConsultationCnss()}
    </div>
  );

  // ─── Table réutilisable ───
  // RG-DECL-CNSS-EDIT : Modification inline des lignes – Adil DAIA
  function startEdit(idx: number) {
    const realIdx = lignes.indexOf(filteredLignes[idx]);
    setEditingIdx(realIdx);
    setEditRow({ ...lignes[realIdx] });
  }

  function saveEdit() {
    if (editingIdx === null) return;
    // RG-DECL-CNSS-03-CIN : CIN obligatoire
    if (!editRow.cin || editRow.cin.trim().length < 4) {
      toast.error("La CIN est obligatoire (minimum 4 caractères)");
      return;
    }
    const updated = [...lignes];
    updated[editingIdx] = { ...updated[editingIdx], ...editRow } as DeclarationLigne;
    // Recalculer la validité
    const errs: string[] = [];
    const r = updated[editingIdx];
    if (!r.cin || r.cin.trim().length < 4) errs.push("CIN manquante ou invalide");
    if (!r.num_cnss && r.statut_salarie !== "ENTRANT") errs.push("N°CNSS manquant");
    if (r.salaire_brut <= 0) errs.push("Salaire brut nul ou négatif");
    if (r.salaire_brut > paramsCnss.plafondBase) errs.push(`Salaire dépasse le plafond (${paramsCnss.plafondBase})`);
    if (r.nombre_jours <= 0 || r.nombre_jours > paramsCnss.plafondJours) errs.push(`Jours hors limite [1-${paramsCnss.plafondJours}]`);
    updated[editingIdx].est_valide = errs.length === 0;
    updated[editingIdx].erreurs = errs.length > 0 ? errs : undefined;
    updated[editingIdx].observations = errs.length > 0 ? errs.join(" | ") : "";
    setLignes(updated);
    setEditingIdx(null);
    setEditRow({});
    toast.success("Ligne mise à jour");
  }

  function cancelEdit() {
    setEditingIdx(null);
    setEditRow({});
  }

  function renderTable() {
    const isEditing = (idx: number) => editingIdx === lignes.indexOf(filteredLignes[idx]);

    return (
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50">
              <th className="px-2 py-2 text-left font-medium text-muted-foreground">Matricule</th>
              <th className="px-2 py-2 text-left font-medium text-muted-foreground">CIN *</th>
              <th className="px-2 py-2 text-left font-medium text-muted-foreground">N°CNSS</th>
              <th className="px-2 py-2 text-left font-medium text-muted-foreground">Nom & Prénom</th>
              <th className="px-2 py-2 text-right font-medium text-muted-foreground">Déclaré</th>
              <th className="px-2 py-2 text-right font-medium text-muted-foreground">Plafonné (CNSS)</th>
              <th className="px-2 py-2 text-center font-medium text-muted-foreground">Jours</th>
              <th className="px-2 py-2 text-center font-medium text-muted-foreground">Statut</th>
              <th className="px-2 py-2 text-left font-medium text-muted-foreground">Observations</th>
              {!consultationMode && (
                <th className="px-2 py-2 text-center font-medium text-muted-foreground w-16">Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {filteredLignes.length === 0 && (
              <tr><td colSpan={consultationMode ? 9 : 10} className="px-4 py-8 text-center text-muted-foreground">Aucune donnée</td></tr>
            )}
            {filteredLignes.map((l, i) => {
              const editing = isEditing(i);
              return (
                <tr key={i} className={`border-t border-border ${!l.est_valide ? "bg-red-500/5" : "hover:bg-muted/30"}`}>
                  <td className="px-2 py-1.5 font-mono">{l.matricule}</td>
                  <td className="px-2 py-1.5">
                    {editing ? (
                      <input
                        value={editRow.cin || ""}
                        onChange={e => setEditRow({ ...editRow, cin: e.target.value })}
                        className={`w-24 px-1.5 py-0.5 rounded border text-xs font-mono ${
                          !editRow.cin || editRow.cin.trim().length < 4
                            ? "border-red-400 bg-red-50 dark:bg-red-950/30"
                            : "border-input bg-background"
                        }`}
                        placeholder="CIN obligatoire"
                        autoFocus
                      />
                    ) : (
                      <span className={`font-mono ${!l.cin || l.cin.trim().length < 4 ? "text-red-500 font-semibold" : ""}`}>
                        {l.cin || <span className="text-red-500">⚠ Manquante</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {editing ? (
                      <input
                        value={editRow.num_cnss || ""}
                        onChange={e => setEditRow({ ...editRow, num_cnss: e.target.value })}
                        className="w-28 px-1.5 py-0.5 rounded border border-input bg-background text-xs font-mono"
                        placeholder="N°CNSS"
                      />
                    ) : (
                      <span className="font-mono">{l.num_cnss || <span className="text-amber-500 font-medium">Non immatriculé</span>}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 font-medium">{l.nom} {l.prenom}</td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">
                    {l.salaire_brut_declare != null
                      ? l.salaire_brut_declare.toLocaleString("fr-FR", { minimumFractionDigits: 2 })
                      : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {editing ? (
                      <input
                        type="number"
                        value={editRow.salaire_brut ?? 0}
                        onChange={e => setEditRow({ ...editRow, salaire_brut: parseFloat(e.target.value) || 0 })}
                        className="w-24 px-1.5 py-0.5 rounded border border-input bg-background text-xs font-mono text-right"
                        step="0.01" min="0"
                      />
                    ) : (
                      <span className={`font-mono ${l.salaire_brut_declare != null && l.salaire_brut_declare > l.salaire_brut ? "text-amber-600 font-semibold" : ""}`}>
                        {l.salaire_brut.toLocaleString("fr-FR", { minimumFractionDigits: 2 })}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {editing ? (
                      <input
                        type="number"
                        value={editRow.nombre_jours ?? 0}
                        onChange={e => setEditRow({ ...editRow, nombre_jours: parseInt(e.target.value) || 0 })}
                        className="w-14 px-1.5 py-0.5 rounded border border-input bg-background text-xs text-center"
                        min="0" max={paramsCnss.plafondJours}
                      />
                    ) : (
                      l.nombre_jours
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {editing ? (
                      <select
                        value={editRow.statut_salarie || "ACTIF"}
                        onChange={e => setEditRow({ ...editRow, statut_salarie: e.target.value })}
                        className="px-1.5 py-0.5 rounded border border-input bg-background text-xs"
                      >
                        {statutsCnss.map(s => (
                          <option key={s.code} value={s.code}>{s.libelle}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                        l.statut_salarie === "ENTRANT" ? "bg-blue-500/10 text-blue-600" :
                        l.statut_salarie === "SORTANT" ? "bg-red-500/10 text-red-600" :
                        "bg-emerald-500/10 text-emerald-600"
                      }`}>
                        {statutsCnss.find(s => s.code === l.statut_salarie)?.libelle || l.statut_salarie}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground max-w-[200px] truncate" title={l.observations}>
                    {l.observations}
                  </td>
                  {!consultationMode && (
                    <td className="px-2 py-1.5 text-center">
                      {editing ? (
                        <div className="flex items-center gap-1 justify-center">
                          <button onClick={saveEdit} className="p-1 rounded hover:bg-emerald-500/10 text-emerald-600" title="Sauvegarder">
                            <Save size={13} />
                          </button>
                          <button onClick={cancelEdit} className="p-1 rounded hover:bg-red-500/10 text-red-500" title="Annuler">
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(i)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground" title="Modifier">
                          <Pencil size={13} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
};

export default DeclarationCnssPage;
