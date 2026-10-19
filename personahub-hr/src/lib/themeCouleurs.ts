/**
 * themeCouleurs.ts — Toutes les couleurs de l'interface, calculées depuis les préférences « Apparence ».
 * Auteur : Adil DAIA — 19/10/2026
 *
 * RG-UI-COULEUR-01 (Adil DAIA) : aucune couleur de l'interface n'est figée. Les 8 couleurs choisies
 *   dans Apparence (principale, secondaire, accent, fond, barre latérale, succès, avertissement,
 *   danger) produisent TOUS les jetons du thème : textes sur fond coloré (contraste calculé),
 *   anneau de sélection, bordures, fonds atténués, texte courant, barre latérale, dégradés, ombres.
 * RG-UI-COULEUR-02 (Adil DAIA) : les familles de couleurs Tailwind (red-600, green-50, gray-100…)
 *   sont rebranchées sur ces préférences (tailwind.config.ts → variables --pal-<famille>-<nuance>) :
 *     red, rose, pink → danger · green, emerald, lime → succès · amber, yellow, orange → avertissement
 *     blue, sky, indigo → principale · cyan, teal → accent · violet, purple, fuchsia → secondaire
 *     gray, slate, zinc, neutral, stone → neutre (teinté de la couleur principale)
 *   Un écran qui écrit « text-red-600 » suit donc la couleur danger de l'utilisateur.
 * Les couleurs de DONNÉES (couleur d'un type d'absence, palette d'un document imprimé) ne sont pas
 * concernées : elles appartiennent à la donnée, pas à l'interface.
 *
 * Module sans dépendance : utilisé par ThemeContext (au changement de préférence) et pour générer
 * les valeurs par défaut de index.css (écran de connexion, avant le chargement des préférences).
 */

export interface PrefsCouleurs {
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  background_color: string;
  sidebar_color: string;
  success_color: string;
  warning_color: string;
  danger_color: string;
}

type HSL = [number, number, number];   // teinte 0-360, saturation 0-100, luminosité 0-100

export function hexVersHsl(hex: string): HSL {
  let h = (hex || "").trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 50];
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let t = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) t = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) t = ((b - r) / d + 2) / 6;
    else t = ((r - g) / d + 4) / 6;
  }
  return [Math.round(t * 360), Math.round(s * 100), Math.round(l * 100)];
}

const borne = (v: number, a = 0, b = 100) => Math.max(a, Math.min(b, v));
/** « 200 60% 22% » : format des variables shadcn, utilisé sous la forme hsl(var(--x) / alpha). */
export const hsl = ([h, s, l]: HSL) => `${Math.round(h)} ${Math.round(borne(s))}% ${Math.round(borne(l))}%`;
const eclaircir = ([h, s, l]: HSL, d: number): HSL => [h, s, borne(l + d)];

function luminance([h, s, l]: HSL): number {
  // HSL → RGB → luminance relative (WCAG)
  const S = s / 100, L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(f(0)) + 0.7152 * lin(f(8)) + 0.0722 * lin(f(4));
}
const contraste = (a: HSL, b: HSL) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** Texte lisible sur un fond (RG-UI-COULEUR-01) : blanc dès qu'il atteint le contraste 3:1 (boutons,
 *  badges en gras), sinon le plus contrasté du blanc et du texte sombre du thème. */
function texteSur(fond: HSL, sombre: HSL): HSL {
  const blanc: HSL = [0, 0, 100];
  const cb = contraste(fond, blanc);
  return cb >= 3 || cb >= contraste(fond, sombre) ? blanc : sombre;
}

// luminosité des nuances 50 → 950, calée sur l'échelle Tailwind
const NUANCES: [string, number][] = [["50", 97], ["100", 94], ["200", 87], ["300", 77], ["400", 64], ["500", 52],
  ["600", 44], ["700", 36], ["800", 28], ["900", 21], ["950", 13]];

/** 11 nuances d'une couleur : même teinte, saturation adoucie vers les extrêmes. */
function nuances(base: HSL, saturationMax?: number): Record<string, HSL> {
  const [h, s] = base;
  const sat = saturationMax !== undefined ? Math.min(s, saturationMax) : s;
  const res: Record<string, HSL> = {};
  for (const [n, l] of NUANCES) {
    const doux = l > 90 ? 0.75 : l < 20 ? 0.8 : 1;
    res[n] = [h, saturationMax !== undefined ? sat : Math.max(sat * doux, 8), l];
  }
  return res;
}

export const FAMILLES_TAILWIND: Record<string, string> = {
  red: "danger", rose: "danger", pink: "danger",
  green: "succes", emerald: "succes", lime: "succes",
  amber: "alerte", yellow: "alerte", orange: "alerte",
  blue: "principale", sky: "principale", indigo: "principale",
  cyan: "accent", teal: "accent",
  violet: "secondaire", purple: "secondaire", fuchsia: "secondaire",
  gray: "neutre", slate: "neutre", zinc: "neutre", neutral: "neutre", stone: "neutre",
};
export const NOMS_NUANCES = NUANCES.map(([n]) => n);

/** Toutes les variables CSS du thème pour ces préférences. */
export function variablesTheme(p: PrefsCouleurs): Record<string, string> {
  const primaire = hexVersHsl(p.primary_color);
  const secondaire = hexVersHsl(p.secondary_color);
  const accent = hexVersHsl(p.accent_color);
  const fond = hexVersHsl(p.background_color);
  const lateral = hexVersHsl(p.sidebar_color);
  const succes = hexVersHsl(p.success_color);
  const alerte = hexVersHsl(p.warning_color);
  const danger = hexVersHsl(p.danger_color);

  const fondClair = fond[2] >= 50;
  // texte courant : sombre, dans la teinte de la couleur principale (clair si le fond est sombre)
  const texte: HSL = fondClair ? [primaire[0], Math.min(primaire[1], 55), 16] : [primaire[0], 25, 95];
  const carte: HSL = fondClair ? [fond[0], Math.min(fond[1], 30), 100] : eclaircir(fond, 5);
  const v: Record<string, string> = {};
  const poser = (nom: string, c: HSL) => { v[`--${nom}`] = hsl(c); };
  const avecTexte = (nom: string, c: HSL) => { poser(nom, c); poser(`${nom}-foreground`, texteSur(c, texte)); };

  poser("background", fond);
  poser("foreground", texte);
  poser("card", carte); poser("card-foreground", texte);
  poser("popover", carte); poser("popover-foreground", texte);
  avecTexte("primary", primaire);
  avecTexte("secondary", secondaire);
  avecTexte("accent", accent);
  avecTexte("destructive", danger);
  avecTexte("danger", danger);
  avecTexte("success", succes);
  avecTexte("warning", alerte);
  avecTexte("info", primaire);
  poser("muted", fondClair ? [fond[0], fond[1], borne(fond[2] - 4)] : eclaircir(fond, 8));
  poser("muted-foreground", fondClair ? [primaire[0], Math.min(primaire[1], 22), 46] : [primaire[0], 15, 68]);
  poser("border", fondClair ? [fond[0], fond[1], borne(fond[2] - 8)] : eclaircir(fond, 14));
  poser("input", fondClair ? [fond[0], fond[1], borne(fond[2] - 8)] : eclaircir(fond, 14));
  poser("ring", accent);

  // barre latérale
  const texteLateral = texteSur(lateral, texte);
  const sombreLateral = lateral[2] < 50;
  poser("sidebar-background", lateral);
  poser("sidebar-foreground", texteLateral[2] > 50 ? [lateral[0], 10, 95] : texteLateral);
  avecTexte("sidebar-primary", accent);
  poser("sidebar-accent", eclaircir(lateral, sombreLateral ? 9 : -7));
  poser("sidebar-accent-foreground", texteLateral[2] > 50 ? [lateral[0], 10, 95] : texteLateral);
  poser("sidebar-border", eclaircir(lateral, sombreLateral ? 6 : -6));
  poser("sidebar-ring", accent);

  // couleurs de marque, dégradés, ombres
  poser("brand-navy", primaire);
  poser("brand-navy-light", eclaircir(primaire, 8));
  poser("brand-teal", secondaire);
  poser("brand-cyan", accent);
  const c = (x: HSL, a?: number) => `hsl(${hsl(x)}${a !== undefined ? ` / ${a}` : ""})`;
  v["--gradient-brand"] = `linear-gradient(135deg, ${c(primaire)}, ${c(eclaircir(primaire, 8))})`;
  v["--gradient-hero"] = `linear-gradient(160deg, ${c(eclaircir(primaire, -6))} 0%, ${c(eclaircir(primaire, 8))} 50%, ${c(accent, 0.3)} 100%)`;
  v["--gradient-green"] = `linear-gradient(135deg, ${c(secondaire)}, ${c(accent)})`;
  v["--shadow-sm"] = `0 1px 3px ${c(primaire, 0.08)}`;
  v["--shadow-md"] = `0 4px 12px ${c(primaire, 0.12)}`;
  v["--shadow-lg"] = `0 8px 24px ${c(primaire, 0.16)}`;
  v["--shadow-glow"] = `0 0 20px ${c(accent, 0.25)}`;

  // RG-UI-COULEUR-02 : nuances des familles Tailwind
  const palettes: Record<string, Record<string, HSL>> = {
    danger: nuances(danger), succes: nuances(succes), alerte: nuances(alerte),
    principale: nuances(primaire), accent: nuances(accent), secondaire: nuances(secondaire),
    neutre: nuances([primaire[0], 10, 50], 10),
  };
  for (const [famille, tons] of Object.entries(palettes))
    for (const [n, ton] of Object.entries(tons)) v[`--pal-${famille}-${n}`] = hsl(ton);
  return v;
}

/** Couleurs Tailwind rebranchées : { red: { 50: "hsl(var(--pal-danger-50) / <alpha-value>)", … }, … } */
export function couleursTailwind(): Record<string, Record<string, string>> {
  const res: Record<string, Record<string, string>> = {};
  for (const [nom, famille] of Object.entries(FAMILLES_TAILWIND)) {
    res[nom] = Object.fromEntries(NOMS_NUANCES.map((n) => [n, `hsl(var(--pal-${famille}-${n}) / <alpha-value>)`]));
  }
  return res;
}
