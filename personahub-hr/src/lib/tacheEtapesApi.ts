// src/lib/tacheEtapesApi.ts
// Client API pour les étapes personnalisées du Kanban
import { api } from "@/lib/api";
import { db } from "@/lib/api";

export interface TacheEtape {
  id: string;
  code: string;
  libelle: string;
  couleur: string;
  icone: string;
  ordre: number;
  est_finale: boolean;
  actif: boolean;
}

export const tacheEtapesApi = {
  list(): Promise<TacheEtape[]> {
    return db.list<TacheEtape>("tache_etape", {
      select: "id,code,libelle,couleur,icone,ordre,est_finale,actif",
      actif: true,
      order: "ordre",
    });
  },
  create(data: Omit<TacheEtape, "id" | "actif">): Promise<TacheEtape> {
    return db.create<TacheEtape>("tache_etape", { ...data, actif: true });
  },
  update(id: string, data: Partial<TacheEtape>): Promise<TacheEtape> {
    return db.update<TacheEtape>("tache_etape", { id }, data);
  },
  delete(id: string): Promise<void> {
    return db.update<any>("tache_etape", { id }, { actif: false });
  },
};
