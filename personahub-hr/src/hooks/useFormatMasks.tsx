/**
 * useFormatMasks.tsx — Hook de formatage selon les masques d'affichage RH
 * Auteur : Adil DAIA
 *
 * Charge une seule fois les masques depuis parametres_rh et expose des
 * fonctions de formatage : formatNumber, formatDate, formatCurrency, formatPercent.
 *
 * Usage :
 *   const { formatNumber, formatDate, formatCurrency, masks } = useFormatMasks();
 *   formatNumber(1234.56)        // "1 234,56"
 *   formatCurrency(1234.56)      // "1 234,56 MAD"
 *   formatDate("2026-05-15")     // "15/05/2026"
 *   formatPercent(15.75)         // "15,75 %"
 */
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Masks {
  date: string;
  decimales: number;
  sepMilliers: string;
  sepDecimal: string;
  symbole: string;
  positionDevise: "AVANT" | "APRES";
  decimalesPourcentage: number;
}

const DEFAULTS: Masks = {
  date: "DD/MM/YYYY",
  decimales: 2,
  sepMilliers: " ",
  sepDecimal: ",",
  symbole: "MAD",
  positionDevise: "APRES",
  decimalesPourcentage: 2,
};

const SEP_MAP: Record<string, string> = {
  SPACE: " ", DOT: ".", COMMA: ",", NONE: "",
};

const codeToSep = (code: string): string =>
  SEP_MAP[code] !== undefined ? SEP_MAP[code] : code;

// Cache module-scope : 1 fetch par session
let cachedMasks: Masks | null = null;
let pendingFetch: Promise<Masks> | null = null;

const fetchMasks = async (): Promise<Masks> => {
  if (cachedMasks) return cachedMasks;
  if (pendingFetch) return pendingFetch;

  pendingFetch = (async () => {
    try {
      const { data } = await supabase
        .from("parametres_rh" as never)
        .select("code,valeur" as never);

      const byCode: Record<string, string> = {};
      ((data || []) as any[]).forEach(d => { byCode[d.code] = d.valeur; });

      const masks: Masks = {
        date: byCode.FORMAT_DATE || DEFAULTS.date,
        decimales: parseInt(byCode.FORMAT_NOMBRE_DECIMALES || "") || DEFAULTS.decimales,
        sepMilliers: codeToSep(byCode.FORMAT_NOMBRE_SEPARATEUR_MILLIERS || "SPACE"),
        sepDecimal: byCode.FORMAT_NOMBRE_SEPARATEUR_DECIMAL || DEFAULTS.sepDecimal,
        symbole: byCode.FORMAT_DEVISE_SYMBOLE || DEFAULTS.symbole,
        positionDevise: (byCode.FORMAT_DEVISE_POSITION as "AVANT" | "APRES") || DEFAULTS.positionDevise,
        decimalesPourcentage: parseInt(byCode.FORMAT_POURCENTAGE_DECIMALES || "") || DEFAULTS.decimalesPourcentage,
      };
      cachedMasks = masks;
      return masks;
    } catch {
      return DEFAULTS;
    } finally {
      pendingFetch = null;
    }
  })();

  return pendingFetch;
};

export const invalidateFormatMasks = () => { cachedMasks = null; };

export interface UseFormatMasksReturn {
  masks: Masks;
  loading: boolean;
  formatNumber: (val: number | string | null | undefined, decimales?: number) => string;
  formatDate: (val: string | Date | null | undefined) => string;
  formatCurrency: (val: number | string | null | undefined) => string;
  formatPercent: (val: number | string | null | undefined) => string;
  parseDate: (val: string) => string; // ISO YYYY-MM-DD pour <input type="date">
}

export function useFormatMasks(): UseFormatMasksReturn {
  const [masks, setMasks] = useState<Masks>(cachedMasks || DEFAULTS);
  const [loading, setLoading] = useState(!cachedMasks);

  useEffect(() => {
    let alive = true;
    fetchMasks().then(m => {
      if (!alive) return;
      setMasks(m);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const formatNumber = useCallback((val: number | string | null | undefined, decimales?: number): string => {
    if (val === null || val === undefined || val === "") return "";
    const n = typeof val === "number" ? val : parseFloat(String(val).replace(/[^\d.\-]/g, "."));
    if (!Number.isFinite(n)) return String(val);
    const dec = decimales ?? masks.decimales;
    const parts = n.toFixed(dec).split(".");
    const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, masks.sepMilliers);
    return parts[1] ? intPart + masks.sepDecimal + parts[1] : intPart;
  }, [masks]);

  const formatDate = useCallback((val: string | Date | null | undefined): string => {
    if (!val) return "";
    const d = val instanceof Date ? val : new Date(val);
    if (isNaN(d.getTime())) return String(val);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = String(d.getFullYear());
    return masks.date
      .replace("DD", dd).replace("MM", mm)
      .replace("YYYY", yyyy).replace("YY", yyyy.slice(-2));
  }, [masks]);

  const formatCurrency = useCallback((val: number | string | null | undefined): string => {
    if (val === null || val === undefined || val === "") return "";
    const n = formatNumber(val);
    return masks.positionDevise === "AVANT"
      ? `${masks.symbole} ${n}`
      : `${n} ${masks.symbole}`;
  }, [masks, formatNumber]);

  const formatPercent = useCallback((val: number | string | null | undefined): string => {
    if (val === null || val === undefined || val === "") return "";
    return formatNumber(val, masks.decimalesPourcentage) + " %";
  }, [masks, formatNumber]);

  const parseDate = useCallback((val: string): string => {
    if (!val) return "";
    // Si déjà ISO -> ne rien faire
    if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val.substring(0, 10);
    const d = new Date(val);
    return isNaN(d.getTime()) ? "" : d.toISOString().substring(0, 10);
  }, []);

  return { masks, loading, formatNumber, formatDate, formatCurrency, formatPercent, parseDate };
}

export default useFormatMasks;
