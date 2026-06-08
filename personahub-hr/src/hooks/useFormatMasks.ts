/**
 * useFormatMasks — Hook global pour appliquer les masques d'affichage paramétrés
 * (cf. /configuration/masques côté admin).
 *
 * SCHÉMA DE STOCKAGE :
 *   Les masques sont stockés dans parametres_rh, UNE LIGNE PAR PARAMÈTRE :
 *     FORMAT_DATE                         → valeur = "DD/MM/YYYY"
 *     FORMAT_NOMBRE_DECIMALES             → valeur = "2"
 *     FORMAT_NOMBRE_SEPARATEUR_MILLIERS   → valeur = "SPACE" | "DOT" | "COMMA" | "NONE"
 *     FORMAT_NOMBRE_SEPARATEUR_DECIMAL    → valeur = "," | "."
 *     FORMAT_DEVISE_SYMBOLE               → valeur = "MAD" | "€" | …
 *     FORMAT_DEVISE_POSITION              → valeur = "AVANT" | "APRES"
 *     FORMAT_POURCENTAGE_DECIMALES        → valeur = "2"
 *     FORMAT_MATRICULE                    → valeur = "######"
 *
 * + invalidateFormatMasks() : à appeler depuis FormatMasksSettings après save.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export type DateMask =
  | "DD/MM/YYYY" | "DD-MM-YYYY" | "DD.MM.YYYY"
  | "MM/DD/YYYY" | "MM-DD-YYYY"
  | "YYYY-MM-DD" | "YYYY/MM/DD"
  | "DD/MM/YY"   | "MM-DD-YY";

export interface FormatMasks {
  dateMask: DateMask;
  decimals: number;
  thousandsSep: string;
  decimalSep: string;
  currencySymbol: string;
  symbolPosition: "AVANT" | "APRES";
  percentDecimals: number;
  matriculeMask: string;
}

const DEFAULTS: FormatMasks = {
  dateMask: "DD/MM/YYYY",
  decimals: 2,
  thousandsSep: " ",
  decimalSep: ",",
  currencySymbol: "MAD",
  symbolPosition: "APRES",
  percentDecimals: 2,
  matriculeMask: "######",
};

const SEP_CODE_TO_CHAR: Record<string, string> = {
  SPACE: " ", DOT: ".", COMMA: ",", NONE: "",
};

let cachedMasks: FormatMasks | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;
let inflightFetch: Promise<FormatMasks> | null = null;
const listeners = new Set<() => void>();

async function fetchMasksOnce(): Promise<FormatMasks> {
  try {
    const rows: any[] = await api.get(
      `/db/parametres_rh?code=like.FORMAT_*&actif=eq.true&select=code,valeur`
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      console.info("[useFormatMasks] Aucun paramètre FORMAT_* en base, défauts appliqués.");
      return DEFAULTS;
    }
    const map: Record<string, string> = {};
    rows.forEach(r => { if (r?.code) map[r.code] = r.valeur ?? ""; });
    return {
      dateMask:        (map.FORMAT_DATE as DateMask) || DEFAULTS.dateMask,
      decimals:        parseInt(map.FORMAT_NOMBRE_DECIMALES || "") || DEFAULTS.decimals,
      thousandsSep:    SEP_CODE_TO_CHAR[map.FORMAT_NOMBRE_SEPARATEUR_MILLIERS] ?? DEFAULTS.thousandsSep,
      decimalSep:      map.FORMAT_NOMBRE_SEPARATEUR_DECIMAL || DEFAULTS.decimalSep,
      currencySymbol:  map.FORMAT_DEVISE_SYMBOLE || DEFAULTS.currencySymbol,
      symbolPosition:  (map.FORMAT_DEVISE_POSITION as "AVANT" | "APRES") || DEFAULTS.symbolPosition,
      percentDecimals: parseInt(map.FORMAT_POURCENTAGE_DECIMALES || "") || DEFAULTS.percentDecimals,
      matriculeMask:   map.FORMAT_MATRICULE || DEFAULTS.matriculeMask,
    };
  } catch (e) {
    console.warn("[useFormatMasks] Fetch erreur, fallback défauts:", e);
    return DEFAULTS;
  }
}

function getMasks(force = false): Promise<FormatMasks> {
  const fresh = Date.now() - cachedAt < CACHE_TTL_MS;
  if (cachedMasks && fresh && !force) return Promise.resolve(cachedMasks);
  if (inflightFetch) return inflightFetch;
  inflightFetch = fetchMasksOnce().then(m => {
    cachedMasks = m;
    cachedAt = Date.now();
    inflightFetch = null;
    return m;
  });
  return inflightFetch;
}

export function invalidateFormatMasks(): void {
  cachedMasks = null;
  cachedAt = 0;
  inflightFetch = null;
  listeners.forEach(fn => { try { fn(); } catch { /* ignore */ } });
}

export function formatDateWith(value: string | Date | null | undefined, masks: FormatMasks): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  const yy = yyyy.slice(-2);
  return masks.dateMask
    .replace("DD", dd).replace("MM", mm)
    .replace("YYYY", yyyy).replace("YY", yy);
}

export function formatNumberWith(value: number | string | null | undefined, masks: FormatMasks, decimals?: number): string {
  if (value == null || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  if (isNaN(n)) return String(value);
  const d = decimals ?? masks.decimals;
  const [intPart, decPart] = n.toFixed(d).split(".");
  const intFmt = masks.thousandsSep
    ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, masks.thousandsSep)
    : intPart;
  return decPart != null ? `${intFmt}${masks.decimalSep}${decPart}` : intFmt;
}

export function formatMoneyWith(value: number | string | null | undefined, masks: FormatMasks): string {
  const formatted = formatNumberWith(value, masks);
  if (!formatted) return "";
  return masks.symbolPosition === "AVANT"
    ? `${masks.currencySymbol} ${formatted}`
    : `${formatted} ${masks.currencySymbol}`;
}

export function formatPercentWith(value: number | string | null | undefined, masks: FormatMasks): string {
  const formatted = formatNumberWith(value, masks, masks.percentDecimals);
  if (!formatted) return "";
  return `${formatted} %`;
}

export function formatMatriculeWith(value: string | null | undefined): string {
  return value ?? "";
}

// ── Helpers SYNCHRONES module-level (utilisables hors composant React) ──────
// Lisent le cache courant ; retombent sur DEFAULTS si pas encore chargé.
// Le cache est rempli dès qu'un composant monte useFormatMasks() quelque part.
export const fmtDate    = (v: string | Date | null | undefined) => formatDateWith(v, cachedMasks ?? DEFAULTS);
export const fmtMoney   = (v: number | string | null | undefined) => formatMoneyWith(v, cachedMasks ?? DEFAULTS);
export const fmtNumber  = (v: number | string | null | undefined, d?: number) => formatNumberWith(v, cachedMasks ?? DEFAULTS, d);
export const fmtPercent = (v: number | string | null | undefined) => formatPercentWith(v, cachedMasks ?? DEFAULTS);
// Masque matricule courant (pour les placeholders d'input)
export const currentMatriculeMask = () => (cachedMasks ?? DEFAULTS).matriculeMask;

export interface UseFormatMasksResult {
  masks: FormatMasks;
  loading: boolean;
  formatDate: (v: string | Date | null | undefined) => string;
  formatMoney: (v: number | string | null | undefined) => string;
  formatNumber: (v: number | string | null | undefined, decimals?: number) => string;
  formatPercent: (v: number | string | null | undefined) => string;
  formatMatricule: (v: string | null | undefined) => string;
  refresh: () => void;
}

export function useFormatMasks(): UseFormatMasksResult {
  const [masks, setMasks] = useState<FormatMasks>(cachedMasks ?? DEFAULTS);
  const [loading, setLoading] = useState(!cachedMasks);

  useEffect(() => {
    let cancelled = false;
    const doFetch = () => {
      getMasks().then(m => {
        if (!cancelled) {
          setMasks(m);
          setLoading(false);
        }
      });
    };
    doFetch();
    const listener = () => doFetch();
    listeners.add(listener);
    return () => { cancelled = true; listeners.delete(listener); };
  }, []);

  return {
    masks,
    loading,
    formatDate:      (v) => formatDateWith(v, masks),
    formatMoney:     (v) => formatMoneyWith(v, masks),
    formatNumber:    (v, d) => formatNumberWith(v, masks, d),
    formatPercent:   (v) => formatPercentWith(v, masks),
    formatMatricule: (v) => formatMatriculeWith(v),
    refresh:         () => invalidateFormatMasks(),
  };
}

export default useFormatMasks;
