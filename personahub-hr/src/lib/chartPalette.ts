/**
 * chartPalette — dérive une palette de couleurs pour les graphiques à partir
 * des couleurs de thème choisies dans Apparence (primary/secondary/accent),
 * au lieu de couleurs codées en dur (ex. "#9f1239", "text-rose-700"...).
 *
 * Pourquoi une palette *dérivée* plutôt que les 3 couleurs de thème brutes :
 * un graphique a souvent besoin de bien plus de 3 séries distinctes (parts
 * par organisation, par plan, par rubrique...). On part des teintes du thème
 * et on tourne la teinte par pas réguliers pour générer autant de couleurs
 * que nécessaire, tout en gardant saturation/luminosité dans une plage
 * lisible — le résultat reste cohérent avec le thème choisi par le client,
 * quel que soit le nombre de séries à afficher.
 */

export interface HSL { h: number; s: number; l: number }

export function hexToHsl(hex: string): HSL {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    switch (max) {
      case r: hue = ((g - b) / d) % 6; break;
      case g: hue = (b - r) / d + 2; break;
      default: hue = (r - g) / d + 4;
    }
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { h: hue, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }: HSL): string {
  const sat = s / 100, lum = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lum, 1 - lum);
  const f = (n: number) => lum - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

export interface CouleursTheme {
  primary_color: string;
  secondary_color: string;
  accent_color: string;
}

export interface CouleursStatut {
  success_color?: string;
  warning_color?: string;
  danger_color?: string;
}

/**
 * Palette "statuts" pour les graphiques sémantiques (répartition de dossiers
 * par état, taux de validation, etc.) — à la différence de paletteGraphes(),
 * qui tourne la teinte pour générer des séries arbitraires sans signification
 * propre, ici chaque couleur a un sens fixe et doit rester stable quel que
 * soit le nombre de séries à l'écran (le "succès" doit toujours être vert/
 * turquoise, jamais une teinte tournée aléatoirement).
 */
export function paletteStatut(theme: CouleursStatut): { succes: string; attente: string; erreur: string } {
  return {
    succes: theme.success_color || "#1E8E5A",
    attente: theme.warning_color || "#D97706",
    erreur: theme.danger_color || "#DC2626",
  };
}

/**
 * Génère `n` couleurs de graphique à partir des couleurs de thème.
 * Les 3 premières sont les couleurs de thème telles quelles (cohérence
 * maximale avec l'identité visuelle) ; au-delà, on tourne la teinte de
 * chaque ancre par pas de 47° (premier avec 360 → pas de cycle qui
 * retomberait sur la même teinte) en variant légèrement la luminosité.
 */
export function paletteGraphes(theme: CouleursTheme, n = 10): string[] {
  const ancres = [theme.primary_color, theme.secondary_color, theme.accent_color]
    .filter(Boolean)
    .map(hexToHsl);
  if (ancres.length === 0) ancres.push({ h: 350, s: 65, l: 35 }); // repli si thème vide

  const couleurs: string[] = [];
  for (let i = 0; i < n; i++) {
    const ancre = ancres[i % ancres.length];
    const tour = Math.floor(i / ancres.length);
    const h = (ancre.h + tour * 47) % 360;
    const s = Math.min(80, Math.max(40, ancre.s));
    const l = Math.min(68, Math.max(28, ancre.l + (tour % 2 === 0 ? 0 : 10) - Math.floor(tour / 2) * 4));
    couleurs.push(hslToHex({ h, s, l }));
  }
  return couleurs;
}
