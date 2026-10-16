// ============================================================
// branding.ts — src/lib/branding.ts
// ------------------------------------------------------------
// Marque blanche : logo + nom du client (titulaire de la licence)
// et extraction automatique d'une palette à partir du logo.
//
// • Stockage GLOBAL (une licence = une entreprise), pas par
//   utilisateur : clé localStorage "anthro_branding".
// • Tout changement émet l'événement "branding:change" pour que
//   la sidebar se mette à jour en direct (même principe que
//   "nav:refresh").
// • Extraction de palette 100 % côté client (canvas), sans
//   dépendance externe.
// ============================================================

export interface Branding {
  clientName: string;
  logoDataUrl: string | null; // image encodée en base64 (data URL)
}

const CLE = "anthro_branding";

export function getBranding(): Branding {
  try {
    const raw = localStorage.getItem(CLE);
    if (raw) return { clientName: "", logoDataUrl: null, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { clientName: "", logoDataUrl: null };
}

export function setBranding(b: Branding): void {
  try { localStorage.setItem(CLE, JSON.stringify(b)); } catch { /* ignore */ }
  window.dispatchEvent(new Event("branding:change"));
}

export function effacerLogo(): void {
  const b = getBranding();
  setBranding({ ...b, logoDataUrl: null });
}

// ──────────────────────────────────────────────────────────────
// Helpers couleur
// ──────────────────────────────────────────────────────────────
export interface RGB { r: number; g: number; b: number; }
export interface Swatch { hex: string; count: number; }

export const hexToRgb = (hex: string): RGB => {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16) };
};

export const rgbToHex = (r: number, g: number, b: number): string =>
  "#" + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");

export const rgbToHsl = ({ r, g, b }: RGB): [number, number, number] => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      default: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
};

export const hslToHex = (h: number, s: number, l: number): string => {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
};

const hslOf = (hex: string) => rgbToHsl(hexToRgb(hex));
export const saturationOf = (hex: string) => hslOf(hex)[1];
export const lightnessOf = (hex: string) => hslOf(hex)[2];
export const hueOf = (hex: string) => hslOf(hex)[0];

/** Modifie la luminosité (et éventuellement la saturation) d'une couleur. */
export const ajusterL = (hex: string, l: number, s?: number): string => {
  const [h, sat] = hslOf(hex);
  return hslToHex(h, s ?? sat, l);
};

const luminance = (hex: string): number => {
  const { r, g, b } = hexToRgb(hex);
  const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

/** Ratio de contraste WCAG entre deux couleurs (1 → 21). */
export const contraste = (hex1: string, hex2: string): number => {
  const a = luminance(hex1), b = luminance(hex2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

/** Texte lisible (blanc ou noir) sur un fond donné. */
export const texteSur = (fond: string): "#FFFFFF" | "#0B0B0B" =>
  contraste(fond, "#FFFFFF") >= contraste(fond, "#0B0B0B") ? "#FFFFFF" : "#0B0B0B";

// ──────────────────────────────────────────────────────────────
// Extraction de palette depuis une image (logo)
// ──────────────────────────────────────────────────────────────
/**
 * Échantillonne l'image, regroupe les couleurs proches et renvoie les
 * teintes dominantes (hors quasi-blanc / quasi-noir / pixels transparents),
 * triées par fréquence.
 */
export function extrairePalette(img: HTMLImageElement, maxCouleurs = 6): Swatch[] {
  const W = 64;
  const H = Math.max(1, Math.round((W * img.naturalHeight) / (img.naturalWidth || 1)));
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, W, H);
  let data: Uint8ClampedArray;
  try { data = ctx.getImageData(0, 0, W, H).data; } catch { return []; }

  const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue; // transparent
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (l > 244) continue; // quasi-blanc
    if (l < 12) continue;  // quasi-noir
    const key = `${r >> 4}-${g >> 4}-${b >> 4}`; // quantification douce
    const cur = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    cur.r += r; cur.g += g; cur.b += b; cur.n++;
    buckets.set(key, cur);
  }

  return [...buckets.values()]
    .map((c) => ({ hex: rgbToHex(c.r / c.n, c.g / c.n, c.b / c.n), count: c.n }))
    .sort((a, b) => b.count - a.count)
    .slice(0, maxCouleurs);
}

export interface ThemeDepuisLogo {
  primary_color: string;
  sidebar_color: string;
  secondary_color: string;
  accent_color: string;
  background_color: string;
}

/**
 * Déduit un thème cohérent à partir d'une palette extraite :
 *  • principale = couleur dominante (de préférence saturée)
 *  • sidebar    = version foncée de la principale
 *  • accent     = couleur la plus vive d'une autre teinte
 *  • secondaire = 2ᵉ couleur marquante
 *  • fond       = teinte très claire dérivée de la principale
 */
export function paletteVersTheme(palette: Swatch[]): ThemeDepuisLogo | null {
  if (!palette.length) return null;
  const colorees = palette.filter((c) => saturationOf(c.hex) > 12);
  const principale = (colorees[0] ?? palette[0]).hex;
  const hPrim = hueOf(principale);

  const candidatAccent =
    colorees.find((c) => Math.abs(hueOf(c.hex) - hPrim) > 25) ??
    colorees[1] ?? colorees[0] ?? palette[0];
  // accent vif : on remonte la saturation et on éclaircit un peu
  const [hA, sA] = hslOf(candidatAccent.hex);
  const accent = hslToHex(hA, Math.min(100, Math.max(sA, 55)), 52);

  const secondaire = (colorees[1] ?? colorees[0] ?? palette[0]).hex;
  const sidebar = ajusterL(principale, Math.max(8, Math.min(20, lightnessOf(principale) * 0.45)));
  const [hP, sP] = hslOf(principale);
  const background = hslToHex(hP, Math.min(sP, 30), 96);

  return {
    primary_color: principale,
    sidebar_color: sidebar,
    secondary_color: secondaire,
    accent_color: accent,
    background_color: background,
  };
}

/** Charge une image depuis une data URL (utilitaire pour l'extraction). */
export function chargerImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}
