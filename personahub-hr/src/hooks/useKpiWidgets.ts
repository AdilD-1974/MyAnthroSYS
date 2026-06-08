import { useState, useEffect } from "react";
import { api } from "@/lib/api";

// =====================================================
// Hook : useKpiWidgets — version FastAPI
// Les KPIs sont charges depuis l'API FastAPI
// =====================================================

export interface KpiWidgetData {
  id: string;
  publicationId: string;
  code: string;
  libelle: string;
  config: Record<string, any>;
  chartData: Array<{ name: string; value: number; fill: string }>;
  total: number;
  loading: boolean;
}

export interface KpiPeriodFilter {
  dateDebut?: string;
  dateFin?: string;
}

export function useKpiWidgets(
  espace: string,
  userId?: string,
  managerCollabIds?: string[],
  periodFilter?: KpiPeriodFilter
) {
  const [widgets, setWidgets] = useState<KpiWidgetData[]>([]);
  const [allPublications, setAllPublications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!espace) return;
    loadWidgets();
  }, [espace, userId]);

  const loadWidgets = async () => {
    setLoading(true);
    try {
      // Charger les KPIs depuis le dashboard FastAPI
      const kpis = await api.get<any>("/dashboard/kpis");

      // Convertir les KPIs en format widget
      const widgetList: KpiWidgetData[] = Object.entries(kpis).map(([key, item]: [string, any], i) => ({
        id: key,
        publicationId: key,
        code: key.toUpperCase(),
        libelle: item.label || key,
        config: {},
        chartData: [{ name: item.label || key, value: item.value || 0, fill: "#3B82F6" }],
        total: item.value || 0,
        loading: false,
      }));

      setWidgets(widgetList);
      setAllPublications(widgetList);
    } catch (err) {
      console.error("Erreur chargement widgets KPI:", err);
      setWidgets([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleWidget = async (publicationId: string, currentVisible: boolean) => {
    // Gestion locale de la visibilite
    if (!currentVisible) {
      setWidgets(prev => prev.filter(w => w.publicationId !== publicationId));
    } else {
      await loadWidgets();
    }
  };

  const isVisible = (publicationId: string): boolean => true;

  return { widgets, allPublications, loading, toggleWidget, isVisible, refresh: loadWidgets };
}
