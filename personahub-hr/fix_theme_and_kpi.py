"""
fix_theme_and_kpi.py
Corrige ThemeContext.tsx et useKpiWidgets.ts pour remplacer Supabase par FastAPI.
Lancer depuis : D:\SOLGEIS\personahub-hr\
"""

import os

# ─── ThemeContext.tsx ─────────────────────────────────────────────────────────
theme_path = os.path.join("src", "contexts", "ThemeContext.tsx")

theme_content = '''import React, { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "./AuthContext";

interface ThemePrefs {
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  background_color: string;
  font_family: string;
  font_size_base: string;
  font_size_heading: string;
  border_radius: string;
  sidebar_color: string;
}

const defaults: ThemePrefs = {
  primary_color: "#0E3D5C",
  secondary_color: "#34A1A1",
  accent_color: "#1DCFCF",
  background_color: "#F1F6F8",
  font_family: "Inter",
  font_size_base: "14",
  font_size_heading: "24",
  border_radius: "8",
  sidebar_color: "#0A2E44",
};

interface ThemeContextType {
  prefs: ThemePrefs;
  updatePrefs: (p: Partial<ThemePrefs>) => Promise<void>;
  loading: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  prefs: defaults, updatePrefs: async () => {}, loading: false,
});

export const useTheme = () => useContext(ThemeContext);

function hexToHSL(hex: string): string {
  let r = 0, g = 0, b = 0;
  if (hex.length === 7) {
    r = parseInt(hex.slice(1, 3), 16) / 255;
    g = parseInt(hex.slice(3, 5), 16) / 255;
    b = parseInt(hex.slice(5, 7), 16) / 255;
  }
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<ThemePrefs>(defaults);
  const [loading, setLoading] = useState(false);

  // Charger le theme depuis localStorage (remplace Supabase)
  useEffect(() => {
    if (!user) return;
    try {
      const saved = localStorage.getItem(`theme_${user.id}`);
      if (saved) setPrefs(JSON.parse(saved));
    } catch {}
  }, [user]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--primary", hexToHSL(prefs.primary_color));
    root.style.setProperty("--sidebar-background", hexToHSL(prefs.sidebar_color));
    root.style.setProperty("--secondary", hexToHSL(prefs.secondary_color));
    root.style.setProperty("--accent", hexToHSL(prefs.accent_color));
    root.style.setProperty("--background", hexToHSL(prefs.background_color));
    root.style.setProperty("--radius", `${prefs.border_radius}px`);
    document.body.style.fontFamily = `'${prefs.font_family}', sans-serif`;
    document.body.style.fontSize = `${prefs.font_size_base}px`;
  }, [prefs]);

  const updatePrefs = async (p: Partial<ThemePrefs>) => {
    const updated = { ...prefs, ...p };
    setPrefs(updated);
    // Sauvegarder dans localStorage (remplace Supabase)
    if (user) {
      localStorage.setItem(`theme_${user.id}`, JSON.stringify(updated));
    }
  };

  return (
    <ThemeContext.Provider value={{ prefs, updatePrefs, loading }}>
      {children}
    </ThemeContext.Provider>
  );
};
'''

with open(theme_path, "w", encoding="utf-8") as f:
    f.write(theme_content)
print(f"OK : {theme_path} corrige (localStorage au lieu de Supabase)")


# ─── useKpiWidgets.ts ─────────────────────────────────────────────────────────
kpi_path = os.path.join("src", "hooks", "useKpiWidgets.ts")

kpi_content = '''import { useState, useEffect } from "react";
import { api } from "@/lib/api";

// =====================================================
// Hook : useKpiWidgets — version FastAPI
// Les KPIs sont charges depuis l\'API FastAPI
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
'''

with open(kpi_path, "w", encoding="utf-8") as f:
    f.write(kpi_content)
print(f"OK : {kpi_path} corrige (FastAPI au lieu de Supabase)")

print("")
print("Correction terminee ! Actualisez le navigateur (F5).")
