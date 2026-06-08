/**
 * useListNavigationContext.tsx — Navigation Précédent/Suivant
 * Auteur : Adil DAIA
 *
 * Permet de conserver le contexte de filtrage d'une liste pour naviguer
 * entre les éléments depuis la page de détail (fiche collaborateur, etc.)
 *
 * Persistance via sessionStorage : conservé tant que l'onglet est ouvert,
 * effacé à la fermeture du navigateur.
 *
 * RG-NAV-CTX-01 (Adil DAIA — 07/05/2026)
 *
 * Usage côté liste :
 *   import { setListNavigationContext } from "@/hooks/useListNavigationContext";
 *
 *   <Card onClick={() => {
 *     setListNavigationContext("collaborateurs", filteredCollaborateurs.map(c => c.id));
 *     navigate(`/collaborateurs/${c.id}`);
 *   }} />
 *
 * Usage côté détail :
 *   import { useListNavigationContext } from "@/hooks/useListNavigationContext";
 *
 *   const nav = useListNavigationContext("collaborateurs", currentId);
 *   //  → { current, total, prevId, nextId, hasContext }
 */
import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";

interface NavContextValue {
  hasContext: boolean;
  current: number;        // 1-based index
  total: number;
  prevId: string | null;
  nextId: string | null;
  goPrev: () => void;
  goNext: () => void;
}

const STORAGE_PREFIX = "anthro_navctx_";

// ─── Helpers exportés ────────────────────────────────────────────────────
export function setListNavigationContext(scope: string, ids: string[]): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + scope, JSON.stringify(ids));
  } catch (e) {
    // sessionStorage peut être désactivé (mode privé strict) — on ignore
    console.warn("[NavCtx] sessionStorage indisponible", e);
  }
}

export function clearListNavigationContext(scope: string): void {
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + scope);
  } catch (e) { /* idem */ }
}

function readContext(scope: string): string[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + scope);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(x => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// ─── Hook principal ──────────────────────────────────────────────────────
interface UseNavOptions {
  /** Builder d'URL React Router (défaut : /scope/id). Utilisé si onNavigate non fourni. */
  pathBuilder?: (id: string) => string;
  /** Callback alternatif au routing — utile pour les formulaires modaux/state local */
  onNavigate?: (id: string) => void;
}

export function useListNavigationContext(
  scope: string,
  currentId: string | undefined,
  optionsOrPath?: UseNavOptions | ((id: string) => string),
): NavContextValue {
  const navigate = useNavigate();

  // Compatibilité : 3e arg peut être pathBuilder (legacy) ou options
  const opts: UseNavOptions =
    typeof optionsOrPath === "function" ? { pathBuilder: optionsOrPath } : (optionsOrPath || {});
  const pathBuilder = opts.pathBuilder || ((id: string) => `/${scope}/${id}`);

  const ids = useMemo(() => readContext(scope), [scope, currentId]);

  const idx = currentId ? ids.indexOf(currentId) : -1;
  const hasContext = idx !== -1 && ids.length > 1;

  const prevId = hasContext && idx > 0 ? ids[idx - 1] : null;
  const nextId = hasContext && idx < ids.length - 1 ? ids[idx + 1] : null;

  const goTo = (id: string) => {
    if (opts.onNavigate) opts.onNavigate(id);
    else navigate(pathBuilder(id));
  };
  const goPrev = () => { if (prevId) goTo(prevId); };
  const goNext = () => { if (nextId) goTo(nextId); };

  // Raccourcis clavier ←/→ (uniquement si pas en train de saisir dans un input)
  useEffect(() => {
    if (!hasContext) return;
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft" && prevId) { e.preventDefault(); goPrev(); }
      else if (e.key === "ArrowRight" && nextId) { e.preventDefault(); goNext(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasContext, prevId, nextId]);

  return {
    hasContext,
    current: idx + 1,
    total: ids.length,
    prevId, nextId,
    goPrev, goNext,
  };
}
