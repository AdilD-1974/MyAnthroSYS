// src/hooks/useTaches.ts
// ------------------------------------------------------------
// Hook React — Module tâches PersonaHub HR
// Adapté à api.ts existant (tokenStore, AppRole)
// ------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import tachesApi, {
  Tache,
  TacheCompteurs,
  TacheCreateInput,
  TacheFilters,
  TachePatchInput,
  TacheStatut,
} from "@/lib/tachesApi";

// ─── Hook liste + CRUD ───────────────────────────────────────

export function useTaches(filters: TacheFilters = {}) {
  const [taches, setTaches]   = useState<Tache[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // Convertit les filtres en clé stable pour le useEffect
  const filtersKey = JSON.stringify(filters);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await tachesApi.list(filters);
      setTaches(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur lors du chargement des tâches.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  useEffect(() => { load(); }, [load]);

  const create = useCallback(async (data: TacheCreateInput) => {
    const t = await tachesApi.create(data);
    setTaches(prev => [t, ...prev]);
    return t;
  }, []);

  const update = useCallback(async (id: string, data: TachePatchInput) => {
    const updated = await tachesApi.update(id, data);
    setTaches(prev => prev.map(t => t.id === id ? updated : t));
    return updated;
  }, []);

  const changeStatut = useCallback(async (id: string, statut: TacheStatut) => {
    const updated = await tachesApi.changeStatut(id, statut);
    setTaches(prev => prev.map(t => t.id === id ? updated : t));
    return updated;
  }, []);

  const remove = useCallback(async (id: string) => {
    await tachesApi.delete(id);
    setTaches(prev => prev.filter(t => t.id !== id));
  }, []);

  return { taches, loading, error, reload: load, create, update, changeStatut, remove };
}


// ─── Hook compteurs (polling toutes les 60s pour le badge) ───

const POLL_INTERVAL = 60_000;

export function useTacheCompteurs() {
  const [compteurs, setCompteurs] = useState<TacheCompteurs>({
    total_actives:    0,
    en_retard:        0,
    dues_aujourd_hui: 0,
    haute_priorite:   0,
  });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCompteurs = useCallback(async () => {
    try {
      const c = await tachesApi.compteurs();
      setCompteurs(c);
    } catch {
      // Silencieux — ne pas crasher si l'API est indisponible
    }
  }, []);

  useEffect(() => {
    fetchCompteurs();
    timerRef.current = setInterval(fetchCompteurs, POLL_INTERVAL);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchCompteurs]);

  return compteurs;
}


// ─── Hook détail d'une tâche ──────────────────────────────────

export function useTacheDetail(id: string | null) {
  const [tache, setTache]     = useState<Tache | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!id) { setTache(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    tachesApi.get(id)
      .then(t  => { if (!cancelled) setTache(t); })
      .catch(e => { if (!cancelled) setError(e.message ?? "Erreur"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  return { tache, loading, error, setTache };
}
