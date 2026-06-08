import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart3, PieChart, Save, Play, Send, Settings2,
  CheckCircle, Eye, Plus, Trash2, RefreshCw, ChevronDown, ChevronUp, DoorOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  PieChart as RechartsPie, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
} from "recharts";
import { differenceInYears, parseISO, subMonths, format } from "date-fns";
import { fr } from "date-fns/locale";

// =====================================================
// Types
// =====================================================
interface KpiConfig {
  id: string;
  code: string;
  libelle: string;
  description: string | null;
  type_kpi: string;
  categorie: string;
  config: Record<string, any>;
  actif: boolean;
}

interface KpiPublication {
  id: string;
  kpi_id: string;
  espace: string;
  position: number;
  actif: boolean;
}

// Espaces disponibles pour la publication des widgets
const ESPACES = [
  { code: "administrateur", label: "Espace Administrateur", color: "hsl(var(--primary))" },
  { code: "gestionnaire_rh", label: "Espace Gestionnaire RH", color: "hsl(197 100% 42%)" },
  { code: "gestionnaire_paie", label: "Espace Gestionnaire Paie", color: "hsl(84 55% 45%)" },
  { code: "manager", label: "Espace Manager", color: "hsl(39 95% 50%)" },
  { code: "collaborateur", label: "Espace Collaborateur", color: "hsl(280 60% 55%)" },
];

// =====================================================
// Composant principal
// =====================================================
const ReportingKpiPage: React.FC = () => {
  const { toast } = useToast();
  const [kpis, setKpis] = useState<KpiConfig[]>([]);
  const [publications, setPublications] = useState<KpiPublication[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKpi, setSelectedKpi] = useState<KpiConfig | null>(null);
  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [expandedConfig, setExpandedConfig] = useState<string | null>(null);
  const [editedConfigs, setEditedConfigs] = useState<Record<string, Record<string, any>>>({});

  // Charger les KPIs et leurs publications au montage
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // RG : Charger tous les KPIs configurés et leurs publications
      const [kpisRes, pubsRes] = await Promise.all([
        supabase.from("kpi_configs").select("*").order("created_at"),
        supabase.from("kpi_publications").select("*").order("position"),
      ]);
      if (kpisRes.data) setKpis(kpisRes.data as KpiConfig[]);
      if (pubsRes.data) setPublications(pubsRes.data as KpiPublication[]);
    } catch (err) {
      toast({ title: "Erreur de chargement", description: "Impossible de charger les KPIs", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // =====================================================
  // RG : Générer les données de prévisualisation
  // en interrogeant directement les collaborateurs actifs
  // =====================================================
  const handlePreview = async (kpi: KpiConfig) => {
    setSelectedKpi(kpi);
    setPreviewLoading(true);
    setPreviewData(null);

    try {
      if (kpi.code === "KPI_REPARTITION_SEXE") {
        // RG : Compter les collaborateurs actifs par genre (M/F)
        const { data } = await supabase
          .from("collaborateur_divers")
          .select("*")
          .eq("collaborateur_id", collaborateurId)
          .maybeSingle();
        if (data) {
          const counts: Record<string, number> = {};
          data.forEach((c: any) => {
            const g = (c.code_genre || "M").trim();
            counts[g] = (counts[g] || 0) + 1;
          });
          // Récupérer les libellés du référentiel genre
          const data = []; const error = null; // Supabase desactive
          const genreMap: Record<string, string> = {};
          (genres || []).forEach((g: any) => { genreMap[g.code] = g.libelle; });

          const cfg = editedConfigs[kpi.id] || kpi.config;
          // RG-KPI-GENRE-01 (Adil DAIA) : Codes ref_genre = "H"/"F" (pas "M"/"F")
          const isMasculin = (code: string) => ["H", "M", "HOMME", "MASCULIN"].includes(code.trim().toUpperCase());
          const chartData = Object.entries(counts).map(([code, count]) => ({
            name: genreMap[code] || code,
            value: count,
            fill: isMasculin(code) ? (cfg.couleur_homme || "#3B82F6") : (cfg.couleur_femme || "#EC4899"),
          }));
          setPreviewData(chartData);
        }
      } else if (kpi.code === "KPI_REPARTITION_AGE") {
        // RG : Calculer l'âge de chaque collaborateur actif
        // et le ranger dans la tranche d'âge correspondante
        const { data } = await supabase
          .from("collaborateur_divers")
          .select("*")
          .eq("collaborateur_id", collaborateurId)
          .maybeSingle();
        if (data) {
          const cfg = editedConfigs[kpi.id] || kpi.config;
          const tranches: Array<{ label: string; min: number; max: number }> = cfg.tranches || [
            { label: "< 25 ans", min: 0, max: 24 },
            { label: "25-34 ans", min: 25, max: 34 },
            { label: "35-44 ans", min: 35, max: 44 },
            { label: "45-54 ans", min: 45, max: 54 },
            { label: "55 ans+", min: 55, max: 999 },
          ];
          const counts = tranches.map(t => ({ ...t, count: 0 }));

          data.forEach((c: any) => {
            if (!c.date_naissance) return;
            const age = differenceInYears(new Date(), parseISO(c.date_naissance));
            const tranche = counts.find(t => age >= t.min && age <= t.max);
            if (tranche) tranche.count++;
          });

          setPreviewData(counts.map(t => ({
            name: t.label,
            value: t.count,
            fill: cfg.couleur_barre || "#8B5CF6",
          })));
        }
      }
    } catch (err) {
      toast({ title: "Erreur de prévisualisation", variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
    // ── KPI Départs ──────────────────────────────────────────
    try {
      const exercice = new Date().getFullYear();
      const cfgDep = editedConfigs[kpi.id] || kpi.config;
      if (kpi.code === "KPI_TOTAL_DEPARTS") {
        const { count } = await (supabase as any)
          .from("collaborateur_departs")
          .select("id", { count: "exact", head: true })
          .eq("statut", "TRAITE")
          .gte("date_depart", `${exercice}-01-01`)
          .lte("date_depart", `${exercice}-12-31`);
        setPreviewData([{ name: "Départs", value: count || 0, fill: cfgDep.couleur || "#EF4444" }]);
      } else if (kpi.code === "KPI_DEPARTS_PAR_MOTIF") {
        const { data } = await (supabase as any)
          .from("collaborateur_departs")
          .select("motif_depart")
          .eq("statut", "TRAITE")
          .gte("date_depart", `${exercice}-01-01`)
          .lte("date_depart", `${exercice}-12-31`);
        const counts: Record<string, number> = {};
        (data || []).forEach((d: any) => { const m = d.motif_depart || "Autre"; counts[m] = (counts[m] || 0) + 1; });
        const colors = cfgDep.couleurs || ["#EF4444","#F59E0B","#8B5CF6","#3B82F6","#10B981","#EC4899","#6366F1"];
        setPreviewData(Object.entries(counts).map(([motif, cnt], i) => ({ name: motif, value: cnt as number, fill: colors[i % colors.length] })));
      } else if (kpi.code === "KPI_DEPARTS_EVOLUTION") {
        const nbMois = cfgDep.nb_mois || 12;
        const now = new Date();
        const moisList = Array.from({ length: nbMois }, (_, i) => {
          const d = subMonths(now, nbMois - 1 - i);
          return { label: format(d, "MMM yy", { locale: fr }), debut: format(d, "yyyy-MM-01"), fin: format(new Date(d.getFullYear(), d.getMonth() + 1, 0), "yyyy-MM-dd"), count: 0 };
        });
        const { data } = await (supabase as any)
          .from("collaborateur_departs").select("date_depart").eq("statut", "TRAITE")
          .gte("date_depart", moisList[0].debut).lte("date_depart", moisList[moisList.length - 1].fin);
        (data || []).forEach((d: any) => {
          const m = moisList.find(m => d.date_depart >= m.debut && d.date_depart <= m.fin);
          if (m) m.count++;
        });
        setPreviewData(moisList.map(m => ({ name: m.label, value: m.count, fill: cfgDep.couleur_barre || "#EF4444" })));
      } else if (kpi.code === "KPI_TAUX_ROTATION") {
        const [{ count: nbDeparts }, { count: effectif }] = await Promise.all([
          (supabase as any).from("collaborateur_departs").select("id", { count: "exact", head: true })
            .eq("statut", "TRAITE").gte("date_depart", `${exercice}-01-01`).lte("date_depart", `${exercice}-12-31`),
          supabase.from("collaborateurs").select("id", { count: "exact", head: true }).eq("archive", false),
        ]);
        const taux = effectif && effectif > 0 ? Math.round(((nbDeparts || 0) / effectif) * 1000) / 10 : 0;
        setPreviewData([{ name: "Turnover %", value: taux, fill: cfgDep.couleur || "#F59E0B" }]);
      }
    } catch (err) {
      // déjà géré ci-dessus
    } finally {
      setPreviewLoading(false);
    }
  };

  // =====================================================
  // RG : Sauvegarder la configuration modifiée d'un KPI
  // =====================================================
  const handleSaveConfig = async (kpi: KpiConfig) => {
    const cfg = editedConfigs[kpi.id];
    if (!cfg) return;
    const { error } = await supabase
      .from("kpi_configs")
      .update({ config: cfg })
      .eq("id", kpi.id);
    if (error) {
      toast({ title: "Erreur de sauvegarde", variant: "destructive" });
    } else {
      toast({ title: "Configuration sauvegardée", description: kpi.libelle });
      setKpis(prev => prev.map(k => k.id === kpi.id ? { ...k, config: cfg } : k));
      setEditedConfigs(prev => { const n = { ...prev }; delete n[kpi.id]; return n; });
    }
  };

  // =====================================================
  // RG : Publier ou dépublier un KPI dans un espace
  // La publication rend le widget visible dans le dashboard
  // de l'espace concerné
  // =====================================================
  const handleTogglePublication = async (kpi: KpiConfig, espace: string) => {
    const existing = publications.find(p => p.kpi_id === kpi.id && p.espace === espace);

    if (existing) {
      // RG : Dépublier = supprimer la ligne de publication
      const { error } = await supabase.from("kpi_publications").delete().eq("id", existing.id);
      if (!error) {
        setPublications(prev => prev.filter(p => p.id !== existing.id));
        toast({ title: "Widget retiré", description: `KPI retiré de l'${ESPACES.find(e => e.code === espace)?.label}` });
      }
    } else {
      // RG : Publier = créer une ligne de publication pour cet espace
      const nextPos = publications.filter(p => p.espace === espace).length;
      const data = []; const error = null; // Supabase desactive
      if (!error && data) {
        setPublications(prev => [...prev, data as KpiPublication]);
        toast({
          title: "Widget publié !",
          description: `KPI publié dans l'${ESPACES.find(e => e.code === espace)?.label}`,
        });
      }
    }
  };

  const isPublished = (kpiId: string, espace: string) =>
    publications.some(p => p.kpi_id === kpiId && p.espace === espace);

  const getPublicationCount = (kpiId: string) =>
    publications.filter(p => p.kpi_id === kpiId).length;

  const updateConfigField = (kpiId: string, field: string, value: any) => {
    setEditedConfigs(prev => ({
      ...prev,
      [kpiId]: { ...(prev[kpiId] || kpis.find(k => k.id === kpiId)?.config || {}), [field]: value },
    }));
  };

  const getEffectiveConfig = (kpi: KpiConfig) => editedConfigs[kpi.id] || kpi.config;

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <RefreshCw className="animate-spin mr-2" size={18} style={{ color: "hsl(var(--primary))" }} />
        <span style={{ color: "hsl(var(--muted-foreground))" }}>Chargement des KPIs...</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "Poppins, sans-serif", color: "hsl(var(--foreground))" }}>
            Données & Reporting — KPIs
          </h1>
          <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
            Paramétrez, prévisualisez et publiez vos indicateurs dans les espaces
          </p>
        </div>
        <Button onClick={fetchData} variant="outline" size="sm" className="gap-2">
          <RefreshCw size={14} />
          Actualiser
        </Button>
      </div>

      {/* Liste des KPIs */}
      <div className="space-y-4">
        {kpis.map(kpi => {
          const cfg = getEffectiveConfig(kpi);
          const isDirty = !!editedConfigs[kpi.id];
          const pubCount = getPublicationCount(kpi.id);
          const isExpanded = expandedConfig === kpi.id;

          return (
            <Card key={kpi.id} style={{ border: "1px solid hsl(var(--border))" }}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{
                        background: kpi.categorie === "departs" ? "hsl(0 70% 50% / 0.1)" : "hsl(var(--primary) / 0.1)",
                        color: kpi.categorie === "departs" ? "hsl(0 70% 45%)" : "hsl(var(--primary))",
                      }}>
                      {kpi.categorie === "departs" ? <DoorOpen size={20} /> : kpi.config.chart_type === "pie" ? <PieChart size={20} /> : <BarChart3 size={20} />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-base">{kpi.libelle}</CardTitle>
                        <Badge variant="outline" className="text-xs">{kpi.code}</Badge>
                        {pubCount > 0 && (
                          <Badge className="text-xs gap-1" style={{ background: "hsl(84 55% 45%)", color: "white" }}>
                            <CheckCircle size={10} />
                            Publié dans {pubCount} espace{pubCount > 1 ? "s" : ""}
                          </Badge>
                        )}
                        {isDirty && (
                          <Badge variant="outline" className="text-xs" style={{ color: "hsl(39 95% 50%)", borderColor: "hsl(39 95% 50%)" }}>
                            Non sauvegardé
                          </Badge>
                        )}
                      </div>
                      {kpi.description && (
                        <p className="text-xs mt-0.5 truncate" style={{ color: "hsl(var(--muted-foreground))" }}>
                          {kpi.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      size="sm" variant="outline"
                      onClick={() => handlePreview(kpi)}
                      className="gap-1.5 text-xs"
                    >
                      <Play size={12} />
                      Essayer
                    </Button>
                    {isDirty && (
                      <Button size="sm" onClick={() => handleSaveConfig(kpi)} className="gap-1.5 text-xs">
                        <Save size={12} />
                        Sauvegarder
                      </Button>
                    )}
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => setExpandedConfig(isExpanded ? null : kpi.id)}
                      className="gap-1 text-xs"
                    >
                      <Settings2 size={12} />
                      Config
                      {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </Button>
                  </div>
                </div>
              </CardHeader>

              {/* Panneau de configuration étendu */}
              {isExpanded && (
                <CardContent className="pt-0 border-t" style={{ borderColor: "hsl(var(--border))" }}>
                  <div className="pt-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Paramètres généraux */}
                    <div className="space-y-4">
                      <h3 className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                        Paramètres du graphique
                      </h3>

                      {/* Titre */}
                      <div>
                        <label className="text-xs font-medium mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>
                          Titre affiché
                        </label>
                        <input
                          type="text"
                          value={cfg.titre || ""}
                          onChange={e => updateConfigField(kpi.id, "titre", e.target.value)}
                          className="w-full px-3 py-2 rounded-md text-sm border"
                          style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
                        />
                      </div>

                      {/* Couleurs selon le type de KPI */}
                      {kpi.code === "KPI_REPARTITION_SEXE" && (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-medium mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>
                              Couleur Hommes
                            </label>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={cfg.couleur_homme || "#3B82F6"}
                                onChange={e => updateConfigField(kpi.id, "couleur_homme", e.target.value)}
                                className="w-10 h-9 rounded border cursor-pointer"
                                style={{ borderColor: "hsl(var(--border))" }}
                              />
                              <span className="text-xs font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>
                                {cfg.couleur_homme || "#3B82F6"}
                              </span>
                            </div>
                          </div>
                          <div>
                            <label className="text-xs font-medium mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>
                              Couleur Femmes
                            </label>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={cfg.couleur_femme || "#EC4899"}
                                onChange={e => updateConfigField(kpi.id, "couleur_femme", e.target.value)}
                                className="w-10 h-9 rounded border cursor-pointer"
                                style={{ borderColor: "hsl(var(--border))" }}
                              />
                              <span className="text-xs font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>
                                {cfg.couleur_femme || "#EC4899"}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {kpi.code === "KPI_REPARTITION_AGE" && (
                        <>
                          <div>
                            <label className="text-xs font-medium mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>
                              Couleur des barres
                            </label>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={cfg.couleur_barre || "#8B5CF6"}
                                onChange={e => updateConfigField(kpi.id, "couleur_barre", e.target.value)}
                                className="w-10 h-9 rounded border cursor-pointer"
                                style={{ borderColor: "hsl(var(--border))" }}
                              />
                              <span className="text-xs font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>
                                {cfg.couleur_barre || "#8B5CF6"}
                              </span>
                            </div>
                          </div>

                          {/* Tranches d'âge configurables */}
                          <div>
                            <label className="text-xs font-medium mb-2 block" style={{ color: "hsl(var(--muted-foreground))" }}>
                              Tranches d'âge
                            </label>
                            <div className="space-y-2">
                              {(cfg.tranches || []).map((t: any, i: number) => (
                                <div key={i} className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={t.label}
                                    onChange={e => {
                                      const newTranches = [...(cfg.tranches || [])];
                                      newTranches[i] = { ...newTranches[i], label: e.target.value };
                                      updateConfigField(kpi.id, "tranches", newTranches);
                                    }}
                                    className="flex-1 px-2 py-1 rounded text-xs border"
                                    style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
                                    placeholder="Libellé"
                                  />
                                  <input
                                    type="number"
                                    value={t.min}
                                    onChange={e => {
                                      const newTranches = [...(cfg.tranches || [])];
                                      newTranches[i] = { ...newTranches[i], min: parseInt(e.target.value) };
                                      updateConfigField(kpi.id, "tranches", newTranches);
                                    }}
                                    className="w-16 px-2 py-1 rounded text-xs border"
                                    style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
                                    placeholder="Min"
                                  />
                                  <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>–</span>
                                  <input
                                    type="number"
                                    value={t.max >= 999 ? "" : t.max}
                                    onChange={e => {
                                      const newTranches = [...(cfg.tranches || [])];
                                      newTranches[i] = { ...newTranches[i], max: e.target.value === "" ? 999 : parseInt(e.target.value) };
                                      updateConfigField(kpi.id, "tranches", newTranches);
                                    }}
                                    className="w-16 px-2 py-1 rounded text-xs border"
                                    style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
                                    placeholder="Max"
                                  />
                                  <button
                                    onClick={() => {
                                      const newTranches = (cfg.tranches || []).filter((_: any, j: number) => j !== i);
                                      updateConfigField(kpi.id, "tranches", newTranches);
                                    }}
                                    className="text-destructive hover:opacity-70"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              ))}
                              <Button
                                size="sm" variant="outline"
                                className="text-xs gap-1 mt-1"
                                onClick={() => {
                                  const newTranches = [...(cfg.tranches || []), { label: "Nouvelle tranche", min: 0, max: 99 }];
                                  updateConfigField(kpi.id, "tranches", newTranches);
                                }}
                              >
                                <Plus size={11} />
                                Ajouter une tranche
                              </Button>
                            </div>
                          </div>
                        </>
                      )}

                      {/* ── Config KPI Départs ── */}
                      {(kpi.code === "KPI_TOTAL_DEPARTS" || kpi.code === "KPI_TAUX_ROTATION") && (
                        <div>
                          <label className="text-xs font-medium mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>
                            Couleur de l'indicateur
                          </label>
                          <div className="flex items-center gap-2">
                            <input type="color"
                              value={cfg.couleur || (kpi.code === "KPI_TAUX_ROTATION" ? "#F59E0B" : "#EF4444")}
                              onChange={e => updateConfigField(kpi.id, "couleur", e.target.value)}
                              className="w-10 h-9 rounded border cursor-pointer"
                              style={{ borderColor: "hsl(var(--border))" }}
                            />
                            <span className="text-xs font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>
                              {cfg.couleur || (kpi.code === "KPI_TAUX_ROTATION" ? "#F59E0B" : "#EF4444")}
                            </span>
                          </div>
                        </div>
                      )}

                      {(kpi.code === "KPI_DEPARTS_PAR_MOTIF" || kpi.code === "KPI_DEPARTS_EVOLUTION") && (
                        <div>
                          <label className="text-xs font-medium mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>
                            Couleur des barres
                          </label>
                          <div className="flex items-center gap-2">
                            <input type="color"
                              value={cfg.couleur_barre || "#EF4444"}
                              onChange={e => updateConfigField(kpi.id, "couleur_barre", e.target.value)}
                              className="w-10 h-9 rounded border cursor-pointer"
                              style={{ borderColor: "hsl(var(--border))" }}
                            />
                            <span className="text-xs font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>
                              {cfg.couleur_barre || "#EF4444"}
                            </span>
                          </div>
                        </div>
                      )}

                      {kpi.code === "KPI_DEPARTS_EVOLUTION" && (
                        <div>
                          <label className="text-xs font-medium mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>
                            Nombre de mois affichés
                          </label>
                          <input type="number" min={3} max={24}
                            value={cfg.nb_mois || 12}
                            onChange={e => updateConfigField(kpi.id, "nb_mois", parseInt(e.target.value))}
                            className="w-24 px-3 py-1.5 rounded text-sm border"
                            style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Publication dans les espaces */}
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}>
                        <Send size={14} />
                        Publier dans les espaces
                      </h3>
                      <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                        Le widget sera affiché dans le tableau de bord de l'espace sélectionné.
                      </p>
                      <div className="space-y-2">
                        {ESPACES.map(espace => {
                          const published = isPublished(kpi.id, espace.code);
                          return (
                            <div
                              key={espace.code}
                              className="flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all"
                              style={{
                                borderColor: published ? espace.color : "hsl(var(--border))",
                                background: published ? `${espace.color}10` : "hsl(var(--background))",
                              }}
                            >
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-2 h-2 rounded-full"
                                  style={{ background: published ? espace.color : "hsl(var(--muted-foreground) / 0.3)" }}
                                />
                                <span className="text-sm font-medium" style={{ color: published ? espace.color : "hsl(var(--foreground))" }}>
                                  {espace.label}
                                </span>
                              </div>
                              <Button
                                size="sm"
                                variant={published ? "default" : "outline"}
                                className="text-xs gap-1 h-7"
                                style={published ? { background: espace.color, borderColor: espace.color } : {}}
                                onClick={() => handleTogglePublication(kpi, espace.code)}
                              >
                                {published ? (
                                  <><CheckCircle size={11} /> Publié</>
                                ) : (
                                  <><Send size={11} /> Publier</>
                                )}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {/* Modal de prévisualisation */}
      {selectedKpi && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => { setSelectedKpi(null); setPreviewData(null); }}
        >
          <div
            className="rounded-2xl p-6 w-full max-w-xl shadow-2xl"
            style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-bold" style={{ fontFamily: "Poppins, sans-serif" }}>
                  <Eye size={16} className="inline mr-2" />
                  Prévisualisation
                </h2>
                <p className="text-sm mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {selectedKpi.libelle}
                </p>
              </div>
              <button
                onClick={() => { setSelectedKpi(null); setPreviewData(null); }}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:opacity-70"
                style={{ background: "hsl(var(--muted))", color: "hsl(var(--foreground))" }}
              >
                ✕
              </button>
            </div>

            {previewLoading ? (
              <div className="flex items-center justify-center h-48">
                <RefreshCw className="animate-spin mr-2" size={18} style={{ color: "hsl(var(--primary))" }} />
                <span style={{ color: "hsl(var(--muted-foreground))" }}>Calcul en cours...</span>
              </div>
            ) : previewData ? (
              <KpiChart kpi={selectedKpi} data={previewData} config={getEffectiveConfig(selectedKpi)} />
            ) : (
              <div className="flex items-center justify-center h-48 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                Aucune donnée disponible
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => { setSelectedKpi(null); setPreviewData(null); }}>
                Fermer
              </Button>
              <Button onClick={() => handlePreview(selectedKpi)} className="gap-2">
                <RefreshCw size={13} />
                Recalculer
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// =====================================================
// Composant de rendu du graphique selon le type de KPI
// =====================================================
const KpiChart: React.FC<{ kpi: KpiConfig; data: any[]; config: Record<string, any> }> = ({ kpi, data, config }) => {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  if (kpi.config.chart_type === "pie" || config.chart_type === "pie") {
    return (
      <div>
        <h3 className="text-sm font-semibold text-center mb-2" style={{ color: "hsl(var(--foreground))" }}>
          {config.titre || kpi.libelle}
        </h3>
        <div className="text-center text-xs mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
          Total : <strong>{total}</strong> collaborateur{total > 1 ? "s" : ""}
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <RechartsPie>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              outerRadius={90}
              dataKey="value"
              label={({ name, value, percent }) =>
                `${name}: ${value} (${(percent * 100).toFixed(1)}%)`
              }
              labelLine={false}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip formatter={(val: any) => [`${val} (${((val / total) * 100).toFixed(1)}%)`, "Effectif"]} />
            <Legend />
          </RechartsPie>
        </ResponsiveContainer>
      </div>
    );
  }

  // Graphique en barres pour les tranches d'âge
  return (
    <div>
      <h3 className="text-sm font-semibold text-center mb-2" style={{ color: "hsl(var(--foreground))" }}>
        {config.titre || kpi.libelle}
      </h3>
      <div className="text-center text-xs mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
        Total : <strong>{total}</strong> collaborateur{total > 1 ? "s" : ""}
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          {config.afficher_grille && <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />}
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
          <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
          <Tooltip formatter={(val: any) => [val, "Effectif"]} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default ReportingKpiPage;
