/**
 * useDashboard.ts — Hooks React Query pour le tableau de bord.
 * À placer dans : src/hooks/useDashboard.ts
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface KpiItem {
  label: string;
  value: number;
  variation?: number;
  detail?: string;
}

interface DashboardKpis {
  collaborateurs_actifs: KpiItem;
  contrats_en_cours: KpiItem;
  conges_en_attente: KpiItem;
  departs_ce_mois: KpiItem;
  organisations: KpiItem;
  postes: KpiItem;
  conges_approuves_mois: KpiItem;
  taux_absenteisme: KpiItem;
}

interface RepartitionItem {
  label: string;
  count: number;
}

export function useDashboardKpis() {
  return useQuery<DashboardKpis>({
    queryKey: ["dashboard", "kpis"],
    queryFn: () => api.get<DashboardKpis>("/dashboard/kpis"),
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchInterval: 1000 * 60 * 10, // Rafraîchir toutes les 10 minutes
  });
}

export function useRepartitionStatuts() {
  return useQuery<RepartitionItem[]>({
    queryKey: ["dashboard", "repartition-statuts"],
    queryFn: () => api.get<RepartitionItem[]>("/dashboard/repartition/statuts"),
    staleTime: 1000 * 60 * 5,
  });
}

export function useRepartitionConges(annee?: number) {
  return useQuery<RepartitionItem[]>({
    queryKey: ["dashboard", "repartition-conges", annee],
    queryFn: () => api.get<RepartitionItem[]>(
      `/dashboard/repartition/conges${annee ? `?annee=${annee}` : ""}`
    ),
    staleTime: 1000 * 60 * 5,
  });
}
