import { useMemo } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { paletteGraphes } from "@/lib/chartPalette";

/**
 * Palette de couleurs de graphiques dérivée du thème choisi dans Apparence.
 * Se recalcule automatiquement si l'utilisateur change de thème.
 *
 *   const palette = useChartPalette(8);
 *   <rect fill={palette[0]} />
 */
export function useChartPalette(n = 10): string[] {
  const { prefs } = useTheme();
  return useMemo(
    () => paletteGraphes(prefs, n),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prefs.primary_color, prefs.secondary_color, prefs.accent_color, n]
  );
}
