import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import {
  Palette, Type, Layout, RotateCcw, Eye, Upload, Sparkles, Trash2, Building2,
  Check, AlertTriangle, BarChart3, Sliders, Square, Search, Info,
} from "lucide-react";
import { getBranding, setBranding, extrairePalette, paletteVersTheme, chargerImage, contraste, type Swatch } from "@/lib/branding";
import { paletteGraphes, paletteStatut } from "@/lib/chartPalette";

// ─────────────────────────────────────────────────────────────────────────
// Référentiels d'options
// ─────────────────────────────────────────────────────────────────────────
const FONTS = [
  { name: "Inter", label: "Inter", category: "Sans-serif moderne" },
  { name: "Poppins", label: "Poppins", category: "Géométrique" },
  { name: "Roboto", label: "Roboto", category: "Sans-serif neutre" },
  { name: "Open Sans", label: "Open Sans", category: "Humaniste" },
  { name: "Lato", label: "Lato", category: "Sans-serif élégant" },
  { name: "Nunito", label: "Nunito", category: "Arrondi" },
  { name: "Source Sans 3", label: "Source Sans", category: "Lisibilité" },
  { name: "Raleway", label: "Raleway", category: "Élégant" },
  { name: "Montserrat", label: "Montserrat", category: "Corporatif" },
  { name: "Work Sans", label: "Work Sans", category: "Sans-serif moderne" },
  { name: "DM Sans", label: "DM Sans", category: "Géométrique" },
  { name: "Manrope", label: "Manrope", category: "Sans-serif moderne" },
  { name: "Rubik", label: "Rubik", category: "Arrondi" },
  { name: "Karla", label: "Karla", category: "Humaniste" },
  { name: "Mulish", label: "Mulish", category: "Sans-serif neutre" },
  { name: "Barlow", label: "Barlow", category: "Technique" },
  { name: "Josefin Sans", label: "Josefin Sans", category: "Élégant" },
  { name: "Quicksand", label: "Quicksand", category: "Arrondi" },
  { name: "IBM Plex Sans", label: "IBM Plex Sans", category: "Corporatif" },
  { name: "Space Grotesk", label: "Space Grotesk", category: "Technique" },
  { name: "Outfit", label: "Outfit", category: "Géométrique" },
  { name: "Figtree", label: "Figtree", category: "Sans-serif moderne" },
  { name: "Merriweather", label: "Merriweather", category: "Sérif classique" },
  { name: "Playfair Display", label: "Playfair", category: "Sérif éditorial" },
  { name: "Lora", label: "Lora", category: "Sérif classique" },
  { name: "Crimson Pro", label: "Crimson Pro", category: "Sérif éditorial" },
  { name: "Ubuntu", label: "Ubuntu", category: "Technique" },
  { name: "JetBrains Mono", label: "JetBrains Mono", category: "Monospace" },
  { name: "IBM Plex Mono", label: "IBM Plex Mono", category: "Monospace" },
  // Polices "bureautique" — déjà présentes sur tous les postes (Windows/Mac/Linux),
  // aucun chargement web nécessaire. Beaucoup de DRH/Paie veulent que l'interface
  // s'accorde avec leurs documents Word/Outlook internes : c'est ce que ces
  // entrées couvrent, avec un rendu instantané et 100% fiable (pas de FOUT).
  { name: "Arial", label: "Arial", category: "Bureautique" },
  { name: "Calibri", label: "Calibri", category: "Bureautique" },
  { name: "Georgia", label: "Georgia", category: "Bureautique" },
  { name: "Verdana", label: "Verdana", category: "Bureautique" },
  { name: "Times New Roman", label: "Times New Roman", category: "Bureautique" },
] as const;

// Polices déjà installées sur le poste (aucun @import / chargement distant) —
// utilisé uniquement pour afficher un petit repère visuel rassurant dans la liste.
const SYSTEM_FONTS = new Set<string>(["Arial", "Calibri", "Georgia", "Verdana", "Times New Roman"]);

const FONT_CATEGORIES = ["Toutes", ...Array.from(new Set(FONTS.map(f => f.category)))];

const FONT_SIZES = [
  { value: "10", label: "Très petit (10px)" },
  { value: "11", label: "Très petit (11px)" },
  { value: "12", label: "Petit (12px)" },
  { value: "13", label: "Réduit (13px)" },
  { value: "14", label: "Normal (14px)" },
  { value: "15", label: "Confort (15px)" },
  { value: "16", label: "Grand (16px)" },
  { value: "17", label: "Très grand (17px)" },
  { value: "18", label: "Maxi (18px)" },
  { value: "19", label: "XL (19px)" },
  { value: "20", label: "XXL (20px)" },
];

const HEADING_SIZES = [
  { value: "16", label: "16px" }, { value: "18", label: "18px" }, { value: "20", label: "20px" },
  { value: "22", label: "22px" }, { value: "24", label: "24px" }, { value: "26", label: "26px" },
  { value: "28", label: "28px" }, { value: "30", label: "30px" }, { value: "32", label: "32px" },
  { value: "36", label: "36px" }, { value: "40", label: "40px" }, { value: "44", label: "44px" },
];

const RADII = [
  { value: "0", label: "Carré" },
  { value: "2", label: "Minime" },
  { value: "4", label: "Léger" },
  { value: "6", label: "Doux" },
  { value: "8", label: "Standard" },
  { value: "10", label: "Confort" },
  { value: "12", label: "Arrondi" },
  { value: "16", label: "Large" },
  { value: "20", label: "Très large" },
  { value: "24", label: "Pill" },
];

// Nouveau — nécessite la prise en charge assortie dans ThemeContext.tsx pour
// s'appliquer réellement à l'interface (voir note en bas de page).
const DENSITES = [
  { value: "compact", label: "Compacte", desc: "Espacements réduits, plus de contenu visible" },
  { value: "confortable", label: "Confortable", desc: "Équilibre par défaut" },
  { value: "spacieuse", label: "Spacieuse", desc: "Respiration accrue, lecture aisée" },
];

const OMBRES = [
  { value: "aucune", label: "Aucune", css: "none" },
  { value: "legere", label: "Légère", css: "0 1px 2px rgba(0,0,0,0.06)" },
  { value: "standard", label: "Standard", css: "0 2px 8px rgba(0,0,0,0.10)" },
  { value: "marquee", label: "Marquée", css: "0 8px 24px rgba(0,0,0,0.16)" },
];

const COLOR_PRESETS = [
  { name: "ANTHRO-SYS (défaut)", cat: "Corporatif", primary: "#0E3D5C", sidebar: "#0A2E44", secondary: "#34A1A1", accent: "#1DCFCF", bg: "#F1F6F8" },
  { name: "Ardoise & Émeraude", cat: "Corporatif", primary: "#1E3A5F", sidebar: "#152B47", secondary: "#2ECC71", accent: "#3498DB", bg: "#F0F4F8" },
  { name: "Gris ardoise", cat: "Corporatif", primary: "#2D3748", sidebar: "#1A202C", secondary: "#68D391", accent: "#63B3ED", bg: "#F7FAFC" },
  { name: "Anthracite & Or", cat: "Corporatif", primary: "#36454F", sidebar: "#1E2B33", secondary: "#C9A84C", accent: "#F0B429", bg: "#F5F5F5" },
  { name: "Marine & Saumon", cat: "Corporatif", primary: "#1A3C5E", sidebar: "#0F2540", secondary: "#E07B6A", accent: "#F4A58A", bg: "#F5F8FC" },
  { name: "Bleu Exécutif", cat: "Corporatif", primary: "#0A2540", sidebar: "#061729", secondary: "#3B82F6", accent: "#60A5FA", bg: "#F4F8FC" },
  { name: "Charbon & Cuivre", cat: "Corporatif", primary: "#292524", sidebar: "#1C1917", secondary: "#B45309", accent: "#D97706", bg: "#FAF9F7" },
  { name: "Indigo Institutionnel", cat: "Corporatif", primary: "#312E81", sidebar: "#1E1B4B", secondary: "#6366F1", accent: "#818CF8", bg: "#F5F5FC" },
  { name: "Corail & Marine", cat: "Vif", primary: "#2F3C7E", sidebar: "#1E2755", secondary: "#F96167", accent: "#F9E795", bg: "#F8F8FC" },
  { name: "Cerise & Blanc", cat: "Vif", primary: "#990011", sidebar: "#660009", secondary: "#2F3C7E", accent: "#CC3344", bg: "#FFF8F8" },
  { name: "Nuit Tropicale", cat: "Vif", primary: "#0A3D62", sidebar: "#061E31", secondary: "#F8B739", accent: "#60A3D9", bg: "#EFF6FC" },
  { name: "Bordeaux & Or", cat: "Vif", primary: "#6B1A1A", sidebar: "#4A0E0E", secondary: "#C9A84C", accent: "#E8C547", bg: "#FAF7F0" },
  { name: "Fuchsia Créatif", cat: "Vif", primary: "#701A75", sidebar: "#4A044E", secondary: "#EC4899", accent: "#F472B6", bg: "#FDF4FA" },
  { name: "Orange Énergique", cat: "Vif", primary: "#7C2D12", sidebar: "#431407", secondary: "#EA580C", accent: "#FB923C", bg: "#FFF7ED" },
  { name: "Turquoise Éclat", cat: "Vif", primary: "#164E4E", sidebar: "#0B2E2E", secondary: "#14B8A6", accent: "#2DD4BF", bg: "#F0FDFA" },
  { name: "Forêt & Mousse", cat: "Nature", primary: "#2C5F2D", sidebar: "#1A3A1B", secondary: "#97BC62", accent: "#4CAF50", bg: "#F4F9F4" },
  { name: "Sauge & Naturel", cat: "Nature", primary: "#50808E", sidebar: "#375A63", secondary: "#84B59F", accent: "#69A297", bg: "#F3F7F6" },
  { name: "Vert Militaire", cat: "Nature", primary: "#3B4A3F", sidebar: "#242E28", secondary: "#7B9E7F", accent: "#A8C5A0", bg: "#F2F5F2" },
  { name: "Terracotta Chaleureux", cat: "Nature", primary: "#B85042", sidebar: "#7A3430", secondary: "#A7BEAE", accent: "#E7E8D1", bg: "#FDF6F5" },
  { name: "Océan Profond", cat: "Nature", primary: "#065A82", sidebar: "#033D59", secondary: "#02C39A", accent: "#1C7293", bg: "#F0F7FA" },
  { name: "Sarcelle & Menthe", cat: "Nature", primary: "#028090", sidebar: "#015A66", secondary: "#02C39A", accent: "#00A896", bg: "#F0FAFA" },
  { name: "Argile & Olive", cat: "Nature", primary: "#4A5D23", sidebar: "#2E3A16", secondary: "#8A9A5B", accent: "#B5C99A", bg: "#F5F7EE" },
  { name: "Lagon Clair", cat: "Nature", primary: "#0F5257", sidebar: "#0A3A3D", secondary: "#7AC1B8", accent: "#A8DADC", bg: "#F0FAF9" },
  { name: "Baie & Crème", cat: "Pastel", primary: "#6D2E46", sidebar: "#4A1E30", secondary: "#A26769", accent: "#E8A598", bg: "#FDF5F0" },
  { name: "Sépia Classique", cat: "Pastel", primary: "#704214", sidebar: "#4A2B0D", secondary: "#C9A96E", accent: "#D4823A", bg: "#FBF5EC" },
  { name: "Prune & Lavande", cat: "Pastel", primary: "#3D1C72", sidebar: "#28124D", secondary: "#8A7FBB", accent: "#C3B8E8", bg: "#F6F4FD" },
  { name: "Rose Poudré", cat: "Pastel", primary: "#7D4F5A", sidebar: "#5A3740", secondary: "#D4A5B0", accent: "#E8C4CC", bg: "#FDF6F7" },
  { name: "Ciel & Craie", cat: "Pastel", primary: "#3E5C76", sidebar: "#2A4058", secondary: "#A7C6DA", accent: "#D3E4ED", bg: "#F6FAFC" },
  { name: "Amande Douce", cat: "Pastel", primary: "#6B5B4C", sidebar: "#4A3E33", secondary: "#C9B79C", accent: "#E3D5C5", bg: "#FBF8F4" },
  { name: "Minuit Exécutif", cat: "Sombre", primary: "#1E2761", sidebar: "#141A42", secondary: "#4A90D9", accent: "#CADCFC", bg: "#F4F6FB" },
  { name: "Violet professionnel", cat: "Sombre", primary: "#4C1D95", sidebar: "#3B0764", secondary: "#7C3AED", accent: "#A78BFA", bg: "#F5F3FF" },
  { name: "Encre Profonde", cat: "Sombre", primary: "#0F172A", sidebar: "#020617", secondary: "#38BDF8", accent: "#7DD3FC", bg: "#F1F5F9" },
  { name: "Prusse & Argent", cat: "Sombre", primary: "#1B2838", sidebar: "#0F1826", secondary: "#8DA9C4", accent: "#C4D6E8", bg: "#F3F6F9" },
  { name: "Aubergine Nocturne", cat: "Sombre", primary: "#3B0A45", sidebar: "#26052E", secondary: "#9D4EDD", accent: "#C77DFF", bg: "#F8F3FA" },
  { name: "Cyberpunk Discret", cat: "Néon", primary: "#0D1321", sidebar: "#06090F", secondary: "#00F5D4", accent: "#F72585", bg: "#F2F6FA" },
  { name: "Laser Vert", cat: "Néon", primary: "#0B3D2E", sidebar: "#062419", secondary: "#39FF14", accent: "#7CFC00", bg: "#F1FAF4" },
  { name: "Ultraviolet", cat: "Néon", primary: "#240046", sidebar: "#10002B", secondary: "#B5179E", accent: "#7209B7", bg: "#F7F0FA" },
  { name: "Ambre Digital", cat: "Néon", primary: "#1A1A2E", sidebar: "#0F0F1E", secondary: "#FFB700", accent: "#FF9500", bg: "#FAF8F2" },
  // Palettes "Signature SIRH" — teintes qui évoquent l'identité visuelle de
  // grandes plateformes RH/paie du marché (violet SaaS, vert éditeur comptable,
  // bleu institutionnel français, orange cloud US, rouge paie historique),
  // recomposées ici sans reprendre aucune marque ni logo.
  { name: "Violet Digital", cat: "Signature SIRH", primary: "#714B67", sidebar: "#4B2E43", secondary: "#017E84", accent: "#F06EA9", bg: "#F9F9FB" },
  { name: "Émeraude Corporate", cat: "Signature SIRH", primary: "#1B5E3F", sidebar: "#123D29", secondary: "#00A656", accent: "#4CAF6D", bg: "#F3FAF5" },
  { name: "Bleu Institutionnel", cat: "Signature SIRH", primary: "#0B2545", sidebar: "#061830", secondary: "#4A6FA5", accent: "#8DA9C4", bg: "#F4F7FA" },
  { name: "Ambre Cloud", cat: "Signature SIRH", primary: "#8C3A0F", sidebar: "#5C2508", secondary: "#F58220", accent: "#FDBE87", bg: "#FFF8F2" },
  { name: "Grenat Paie", cat: "Signature SIRH", primary: "#7A1220", sidebar: "#4D0B14", secondary: "#D0021B", accent: "#F26D7D", bg: "#FDF4F5" },
  // Palette "Corporate & Energy" — bleu confiance/structure + orange dynamisme/action,
  // inspirée de la charte SIRH fournie (bleu océan profond en primaire, orange vitalité
  // en accent d'action, fond très clair pour préserver la lisibilité).
  // success/warning repris de la section "Data Visualization" de la charte (turquoise
  // pour les indicateurs positifs, ambre pour les états intermédiaires) afin que le
  // clic sur ce preset harmonise aussi les badges de statut, pas seulement primary/accent.
  {
    name: "Corporate & Energy", cat: "Signature SIRH",
    primary: "#1E3A8A", sidebar: "#14275F", secondary: "#2563EB", accent: "#F97316", bg: "#F8FAFC",
    success: "#14B8A6", warning: "#F59E0B",
  },
] as const;

const PRESET_CATEGORIES = ["Toutes", ...Array.from(new Set(COLOR_PRESETS.map(p => p.cat)))];

// ─────────────────────────────────────────────────────────────────────────
// Petits composants réutilisables
// ─────────────────────────────────────────────────────────────────────────
const ColorSwatch: React.FC<{ label: string; value: string; onChange: (v: string) => void; hint?: string }> = ({
  label, value, onChange, hint
}) => (
  <div className="flex items-center justify-between py-3 border-b last:border-0" style={{ borderColor: "hsl(var(--border))" }}>
    <div className="flex items-center gap-3 min-w-0">
      <div className="relative w-9 h-9 rounded-lg border-2 cursor-pointer overflow-hidden flex-shrink-0 shadow-sm" style={{ borderColor: "hsl(var(--border))" }}>
        <div className="absolute inset-0" style={{ background: value }} />
        <input type="color" value={value} onChange={e => onChange(e.target.value)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
      </div>
      <div className="min-w-0">
        <label className="text-sm font-medium block">{label}</label>
        {hint && <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{hint}</p>}
      </div>
    </div>
    <div className="flex items-center gap-2 flex-shrink-0">
      <span className="text-xs font-mono px-2 py-1 rounded hidden sm:block" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
        {value.toUpperCase()}
      </span>
      <div className="relative w-9 h-9 rounded-lg overflow-hidden border cursor-pointer" style={{ borderColor: "hsl(var(--border))" }}>
        <div className="absolute inset-0" style={{ background: value }} />
        <input type="color" value={value} onChange={e => onChange(e.target.value)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
      </div>
    </div>
  </div>
);

const SectionHeader: React.FC<{ icon: React.ReactNode; title: string; subtitle?: string; nouveau?: boolean }> = ({ icon, title, subtitle, nouveau }) => (
  <div className="flex items-start gap-3 mb-5">
    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }}>
      {icon}
    </div>
    <div>
      <h2 className="text-base font-bold flex items-center gap-2" style={{ fontFamily: "Poppins, sans-serif" }}>
        {title}
        {nouveau && (
          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
            style={{ background: "hsl(var(--accent) / 0.15)", color: "hsl(var(--accent))" }}>
            Nouveau
          </span>
        )}
      </h2>
      {subtitle && <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{subtitle}</p>}
    </div>
  </div>
);

const ChipFiltre: React.FC<{ label: string; actif: boolean; onClick: () => void }> = ({ label, actif, onClick }) => (
  <button
    onClick={onClick}
    className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
    style={{
      borderColor: actif ? "hsl(var(--accent))" : "hsl(var(--border))",
      background: actif ? "hsl(var(--accent))" : "transparent",
      color: actif ? "white" : "hsl(var(--muted-foreground))",
    }}
  >
    {label}
  </button>
);

// ─────────────────────────────────────────────────────────────────────────
const AppearancePage: React.FC = () => {
  const { prefs, updatePrefs } = useTheme();

  // ── Marque client (logo + nom + palette déduite) ──────────────
  const fileRef = useRef<HTMLInputElement>(null);
  const [clientName, setClientName] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [palette, setPalette] = useState<Swatch[]>([]);
  const [extraction, setExtraction] = useState(false);

  // ── Filtres des galeries élargies ──────────────────────────────
  const [presetCat, setPresetCat] = useState("Toutes");
  const [presetQuery, setPresetQuery] = useState("");
  const [fontCat, setFontCat] = useState("Toutes");

  useEffect(() => {
    const b = getBranding();
    setClientName(b.clientName);
    setLogo(b.logoDataUrl);
    if (b.logoDataUrl) {
      chargerImage(b.logoDataUrl).then((img) => setPalette(extrairePalette(img))).catch(() => {});
    }
  }, []);

  const onFichier = (file?: File | null) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result);
      setLogo(dataUrl);
      setExtraction(true);
      setBranding({ clientName: clientName.trim(), logoDataUrl: dataUrl }); // maj sidebar en direct
      try { const img = await chargerImage(dataUrl); setPalette(extrairePalette(img)); }
      catch { setPalette([]); }
      finally { setExtraction(false); }
    };
    reader.readAsDataURL(file);
  };

  const retirerLogo = () => { setLogo(null); setPalette([]); setBranding({ clientName: clientName.trim(), logoDataUrl: null }); };
  const enregistrerMarque = () => setBranding({ clientName: clientName.trim(), logoDataUrl: logo });
  const genererTheme = () => { const t = paletteVersTheme(palette); if (t) updatePrefs(t); };

  const defaults = {
    primary_color: "#0E3D5C",
    secondary_color: "#34A1A1",
    accent_color: "#1DCFCF",
    background_color: "#F1F6F8",
    sidebar_color: "#0A2E44",
    // Nouveau — voir note "Couleurs avancées" plus bas
    success_color: "#1E8E5A",
    warning_color: "#D97706",
    danger_color: "#DC2626",
    font_family: "Inter",
    font_family_heading: "Poppins",
    font_size_base: "14",
    font_size_heading: "24",
    border_radius: "8",
    density: "confortable",
    shadow_style: "standard",
  };

  const applyPreset = (preset: typeof COLOR_PRESETS[number]) => {
    const p = preset as any;
    updatePrefs({
      primary_color: preset.primary,
      sidebar_color: preset.sidebar,
      secondary_color: preset.secondary,
      accent_color: preset.accent,
      background_color: preset.bg,
      // Certains presets (ex. "Corporate & Energy") définissent aussi des couleurs
      // de statut assorties ; sinon on ne touche pas à success/warning existants.
      ...(p.success ? { success_color: p.success } : {}),
      ...(p.warning ? { warning_color: p.warning } : {}),
    } as any);
  };

  const presetsFiltres = useMemo(() => COLOR_PRESETS.filter(p =>
    (presetCat === "Toutes" || p.cat === presetCat) &&
    (!presetQuery.trim() || p.name.toLowerCase().includes(presetQuery.trim().toLowerCase()))
  ), [presetCat, presetQuery]);

  const fontsFiltrees = useMemo(() => FONTS.filter(f => fontCat === "Toutes" || f.category === fontCat), [fontCat]);

  // Palette de graphiques dérivée du thème courant — même logique que
  // useChartPalette(), en aperçu ici pour montrer le résultat sans avoir à
  // ouvrir un écran avec des graphiques.
  const paletteGraphiques = useMemo(
    () => paletteGraphes(prefs, 8),
    [prefs.primary_color, prefs.secondary_color, prefs.accent_color]
  );

  // Couleurs "sens fixe" (succès/attente/erreur) pour les graphiques
  // sémantiques (répartition de dossiers par état, etc.) — distinctes de
  // paletteGraphiques qui tourne la teinte pour des séries sans signification propre.
  const statutsGraphiques = useMemo(
    () => paletteStatut(prefs),
    [prefs.success_color, prefs.warning_color, prefs.danger_color]
  );

  const section = "rounded-xl p-6 mb-4";
  const cardStyle = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", boxShadow: "var(--shadow-sm)" };
  const ombreActuelle = OMBRES.find(o => o.value === prefs.shadow_style)?.css ?? OMBRES[2].css;

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <div className="page-header">
        <h1 className="page-title">Apparence</h1>
        <p className="page-subtitle">Personnalisez entièrement l'interface selon vos préférences</p>
      </div>

      {/* Note sur les options avancées */}
      <div className="mb-4 rounded-xl p-4 flex items-start gap-3 text-sm" style={{ background: "hsl(var(--accent) / 0.08)", border: "1px solid hsl(var(--accent) / 0.25)" }}>
        <Info size={16} className="mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--accent))" }} />
        <p style={{ color: "hsl(var(--foreground))" }}>
          Les sections marquées <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--accent) / 0.15)", color: "hsl(var(--accent))" }}>Nouveau</span> introduisent
          de nouveaux réglages (couleurs de statut, police des titres, densité, ombres). Ils sont sauvegardés et appliqués via <code className="px-1 rounded" style={{ background: "hsl(var(--muted))" }}>ThemeContext.tsx</code> (variables CSS <code className="px-1 rounded" style={{ background: "hsl(var(--muted))" }}>--success</code>, <code className="px-1 rounded" style={{ background: "hsl(var(--muted))" }}>--warning</code>, <code className="px-1 rounded" style={{ background: "hsl(var(--muted))" }}>--danger</code>, <code className="px-1 rounded" style={{ background: "hsl(var(--muted))" }}>--font-family-heading</code>, <code className="px-1 rounded" style={{ background: "hsl(var(--muted))" }}>--space-scale</code>, <code className="px-1 rounded" style={{ background: "hsl(var(--muted))" }}>--shadow-app</code>). Il reste à faire consommer <code className="px-1 rounded" style={{ background: "hsl(var(--muted))" }}>--space-scale</code> et <code className="px-1 rounded" style={{ background: "hsl(var(--muted))" }}>--shadow-app</code> par le CSS des composants existants (padding/box-shadow) pour que densité et ombres se voient partout, pas seulement dans l'aperçu ci-dessous.
        </p>
      </div>

      {/* Marque client */}
      <div className={section} style={cardStyle}>
        <SectionHeader icon={<Building2 size={16} />} title="Marque client" subtitle="Logo du titulaire de la licence + palette déduite automatiquement" />
        <div className="flex flex-col sm:flex-row gap-5">
          <div className="sm:w-48 flex-shrink-0">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => onFichier(e.target.files?.[0])} />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full aspect-video rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-colors overflow-hidden hover:shadow-sm"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted))" }}
            >
              {logo ? (
                <img src={logo} alt="Logo client" className="max-h-full max-w-full object-contain p-2" />
              ) : (
                <>
                  <Upload size={22} style={{ color: "hsl(var(--muted-foreground))" }} />
                  <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Importer le logo</span>
                  <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>PNG, SVG, JPG</span>
                </>
              )}
            </button>
            {logo && (
              <button onClick={retirerLogo} className="mt-2 w-full text-xs flex items-center justify-center gap-1.5 py-1.5 rounded-lg transition-colors hover:bg-red-50" style={{ color: "hsl(0 84% 55%)" }}>
                <Trash2 size={13} /> Retirer le logo
              </button>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <label className="text-xs font-medium block mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Nom de l'entreprise</label>
            <div className="flex gap-2 mb-4">
              <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="ex : SOLGEIS Consulting"
                className="flex-1 text-sm rounded-lg px-3 py-2 outline-none"
                style={{ background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
              <button onClick={enregistrerMarque} className="px-3 py-2 rounded-lg text-sm font-medium" style={{ background: "hsl(var(--primary))", color: "white" }}>
                Enregistrer
              </button>
            </div>

            <label className="text-xs font-medium block mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>
              Palette détectée{extraction ? " …" : ""}
            </label>
            {palette.length ? (
              <>
                <div className="flex flex-wrap gap-2 mb-3">
                  {palette.map(c => (
                    <button key={c.hex} title={`${c.hex} — clic : couleur principale · Maj+clic : accentuation`}
                      onClick={e => updatePrefs(e.shiftKey ? { accent_color: c.hex } : { primary_color: c.hex })}
                      className="w-9 h-9 rounded-lg border shadow-sm transition-transform hover:scale-110"
                      style={{ background: c.hex, borderColor: "hsl(var(--border))" }} />
                  ))}
                </div>
                <button onClick={genererTheme} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
                  style={{ background: "hsl(var(--accent))", color: "white" }}>
                  <Sparkles size={15} /> Générer le thème depuis le logo
                </button>
                <p className="text-[11px] mt-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Clic sur une pastille = couleur principale · Maj+clic = accentuation.
                </p>
              </>
            ) : (
              <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                Importez un logo pour détecter automatiquement ses couleurs dominantes.
              </p>
            )}

            {(() => {
              const ratio = contraste(prefs.primary_color, "#FFFFFF");
              const ok = ratio >= 4.5;
              const niveau = ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA gros texte" : "insuffisant";
              return (
                <div className="mt-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
                  style={{ background: ok ? "hsl(var(--accent) / 0.12)" : "hsl(0 84% 95%)", color: ok ? "hsl(var(--accent))" : "hsl(0 84% 45%)" }}>
                  {ok ? <Check size={12} /> : <AlertTriangle size={12} />}
                  Texte blanc sur principale : {ratio.toFixed(1)} ({niveau})
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Palettes prédéfinies — élargi + catégorisé + recherche */}
      <div className={section} style={cardStyle}>
        <SectionHeader icon={<Palette size={16} />} title="Palettes prédéfinies" subtitle={`${COLOR_PRESETS.length} thèmes complets, appliqués en un clic`} />
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-[160px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
            <input
              value={presetQuery} onChange={e => setPresetQuery(e.target.value)} placeholder="Rechercher une palette…"
              className="w-full text-sm rounded-lg pl-8 pr-3 py-1.5 outline-none"
              style={{ background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {PRESET_CATEGORIES.map(c => (
            <ChipFiltre key={c} label={c} actif={presetCat === c} onClick={() => setPresetCat(c)} />
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[420px] overflow-y-auto pr-1">
          {presetsFiltres.map(preset => (
            <button
              key={preset.name}
              onClick={() => applyPreset(preset)}
              className="flex items-center gap-3 px-4 py-3 rounded-lg border transition-all hover:shadow-md text-left"
              style={{
                borderColor: preset.primary === prefs.primary_color ? preset.primary : "hsl(var(--border))",
                background: preset.primary === prefs.primary_color ? `${preset.primary}08` : "transparent",
              }}
            >
              <div className="flex gap-1 flex-shrink-0">
                {[preset.primary, preset.secondary, preset.accent].map((c, i) => (
                  <div key={i} className="w-4 h-4 rounded-full border" style={{ background: c, borderColor: "hsl(0 0% 80%)" }} />
                ))}
              </div>
              <div className="min-w-0">
                <span className="text-sm font-medium flex items-center gap-1.5 min-w-0">
                  <span className="truncate">{preset.name}</span>
                  {(preset as any).success && (
                    <span className="text-[9px] font-semibold uppercase tracking-wide px-1 py-px rounded flex-shrink-0" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }} title="Inclut des couleurs de statut (succès/avertissement) assorties">
                      + statuts
                    </span>
                  )}
                </span>
                <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>{preset.cat}</span>
              </div>
            </button>
          ))}
          {presetsFiltres.length === 0 && (
            <p className="col-span-2 text-sm text-center py-6" style={{ color: "hsl(var(--muted-foreground))" }}>
              Aucune palette ne correspond à « {presetQuery} ».
            </p>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        {/* Couleurs personnalisées */}
        <div className={section.replace("mb-4", "")} style={cardStyle}>
          <SectionHeader icon={<Palette size={16} />} title="Couleurs personnalisées" subtitle="Cliquez sur un carré de couleur pour modifier" />
          <ColorSwatch label="Couleur principale" value={prefs.primary_color} onChange={v => updatePrefs({ primary_color: v })} hint="Boutons, en-têtes, éléments clés" />
          <ColorSwatch label="Barre latérale" value={prefs.sidebar_color} onChange={v => updatePrefs({ sidebar_color: v })} hint="Fond du menu de navigation" />
          <ColorSwatch label="Couleur secondaire" value={prefs.secondary_color} onChange={v => updatePrefs({ secondary_color: v })} hint="Badges, indicateurs de succès" />
          <ColorSwatch label="Couleur d'accentuation" value={prefs.accent_color} onChange={v => updatePrefs({ accent_color: v })} hint="Liens, focus, surbrillance" />
          <ColorSwatch label="Couleur de fond" value={prefs.background_color} onChange={v => updatePrefs({ background_color: v })} hint="Arrière-plan général de l'application" />
        </div>

        {/* NOUVEAU — Couleurs avancées (statuts) */}
        <div className={section.replace("mb-4", "")} style={cardStyle}>
          <SectionHeader icon={<Palette size={16} />} title="Couleurs de statut" subtitle="Succès, avertissement, erreur — utilisées dans les badges et alertes" nouveau />
          <ColorSwatch label="Succès" value={prefs.success_color ?? defaults.success_color} onChange={v => updatePrefs({ success_color: v })} hint="Validé, clôturé, en ordre" />
          <ColorSwatch label="Avertissement" value={prefs.warning_color ?? defaults.warning_color} onChange={v => updatePrefs({ warning_color: v })} hint="À vérifier, en attente" />
          <ColorSwatch label="Erreur" value={prefs.danger_color ?? defaults.danger_color} onChange={v => updatePrefs({ danger_color: v })} hint="Bloquant, en anomalie" />
        </div>
      </div>

      {/* NOUVEAU — Palette de graphiques (aperçu, lecture seule) */}
      <div className={section} style={cardStyle}>
        <SectionHeader icon={<BarChart3 size={16} />} title="Palette de graphiques" subtitle="Dérivée automatiquement de vos couleurs ci-dessus — aucun réglage à faire" nouveau />
        <div className="flex flex-wrap gap-3">
          {paletteGraphiques.map((c, i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <div className="w-10 h-10 rounded-lg shadow-sm border" style={{ background: c, borderColor: "hsl(var(--border))" }} />
              <span className="text-[10px] font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>{c.toUpperCase()}</span>
            </div>
          ))}
        </div>
        <p className="text-xs mt-4" style={{ color: "hsl(var(--muted-foreground))" }}>
          Utilisée par les écrans de paie (courbes, barres, camemberts) via <code className="px-1 rounded" style={{ background: "hsl(var(--muted))" }}>useChartPalette()</code> — change automatiquement avec votre thème.
        </p>

        <div className="mt-5 pt-4" style={{ borderTop: "1px solid hsl(var(--border))" }}>
          <label className="text-xs font-semibold block mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
            COULEURS DE STATUT (graphiques à sens fixe — ex. répartition par état de dossier)
          </label>
          <div className="flex flex-wrap gap-4">
            {[
              { label: "Succès", value: statutsGraphiques.succes },
              { label: "Attente", value: statutsGraphiques.attente },
              { label: "Erreur", value: statutsGraphiques.erreur },
            ].map(s => (
              <div key={s.label} className="flex flex-col items-center gap-1.5">
                <div className="w-10 h-10 rounded-lg shadow-sm border" style={{ background: s.value, borderColor: "hsl(var(--border))" }} />
                <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>{s.label}</span>
                <span className="text-[10px] font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>{s.value.toUpperCase()}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] mt-3" style={{ color: "hsl(var(--muted-foreground))" }}>
            Dérivée de vos couleurs de statut ci-dessus via <code className="px-1 rounded" style={{ background: "hsl(var(--muted))" }}>paletteStatut()</code> — contrairement à la palette générale, ces 3 couleurs gardent toujours le même sens.
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        {/* Typography - Font Family */}
        <div className={section.replace("mb-4", "")} style={cardStyle}>
          <SectionHeader icon={<Type size={16} />} title="Police de caractères" subtitle={`${FONTS.length} polices disponibles pour le texte courant`} />
          <div className="flex flex-wrap gap-1.5 mb-4">
            {FONT_CATEGORIES.map(c => (
              <ChipFiltre key={c} label={c} actif={fontCat === c} onClick={() => setFontCat(c)} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 max-h-[300px] overflow-y-auto pr-1">
            {fontsFiltrees.map(f => (
              <button
                key={f.name}
                onClick={() => updatePrefs({ font_family: f.name })}
                className="flex flex-col items-start px-3 py-2.5 rounded-lg border transition-all text-left"
                style={{
                  borderColor: prefs.font_family === f.name ? "hsl(var(--accent))" : "hsl(var(--border))",
                  background: prefs.font_family === f.name ? "hsl(var(--accent) / 0.08)" : "transparent",
                  fontFamily: f.name,
                }}
              >
                <span className="text-sm font-semibold" style={{ color: prefs.font_family === f.name ? "hsl(var(--accent))" : "hsl(var(--foreground))" }}>
                  {f.label}
                </span>
                <span className="text-xs mt-0.5 flex items-center gap-1" style={{ color: "hsl(var(--muted-foreground))", fontFamily: "Inter" }}>
                  {f.category}
                  {SYSTEM_FONTS.has(f.name) && (
                    <span className="text-[9px] font-semibold uppercase tracking-wide px-1 py-px rounded" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                      déjà sur le poste
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-4 p-3 rounded-lg" style={{ background: "hsl(var(--muted))" }}>
            <p className="text-xs mb-1" style={{ color: "hsl(var(--muted-foreground))", fontFamily: "Inter" }}>Aperçu de la police :</p>
            <p className="text-base font-medium" style={{ fontFamily: prefs.font_family }}>
              ANTHRO-SYS — Gestion des Ressources Humaines 1234567890
            </p>
          </div>
        </div>

        {/* NOUVEAU — Police des titres, distincte du texte courant */}
        <div className={section.replace("mb-4", "")} style={cardStyle}>
          <SectionHeader icon={<Type size={16} />} title="Police des titres" subtitle="Optionnel — laissez la police par défaut pour garder titres et texte assortis" nouveau />
          <div className="grid grid-cols-2 gap-2 max-h-[300px] overflow-y-auto pr-1">
            {FONTS.map(f => (
              <button
                key={f.name}
                onClick={() => updatePrefs({ font_family_heading: f.name })}
                className="flex flex-col items-start px-3 py-2.5 rounded-lg border transition-all text-left"
                style={{
                  borderColor: prefs.font_family_heading === f.name ? "hsl(var(--primary))" : "hsl(var(--border))",
                  background: prefs.font_family_heading === f.name ? "hsl(var(--primary) / 0.08)" : "transparent",
                  fontFamily: f.name,
                }}
              >
                <span className="text-sm font-bold flex items-center gap-1" style={{ color: prefs.font_family_heading === f.name ? "hsl(var(--primary))" : "hsl(var(--foreground))" }}>
                  {f.label}
                  {SYSTEM_FONTS.has(f.name) && (
                    <span className="text-[9px] font-semibold uppercase tracking-wide px-1 py-px rounded" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                      système
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-4 p-3 rounded-lg" style={{ background: "hsl(var(--muted))" }}>
            <p className="text-xl font-bold" style={{ fontFamily: prefs.font_family_heading || prefs.font_family }}>
              Vue d'ensemble du traitement
            </p>
          </div>
        </div>
      </div>

      {/* Typography - Sizes */}
      <div className={section} style={cardStyle}>
        <SectionHeader icon={<Type size={16} />} title="Tailles de texte" subtitle="Ajustez la hiérarchie typographique" />

        <div className="grid lg:grid-cols-2 gap-6">
          <div>
            <label className="text-xs font-semibold block mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
              TAILLE DU TEXTE COURANT
            </label>
            <div className="grid grid-cols-2 gap-1.5 max-h-[300px] overflow-y-auto pr-1">
              {FONT_SIZES.map(s => (
                <button
                  key={s.value}
                  onClick={() => updatePrefs({ font_size_base: s.value })}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all"
                  style={{
                    borderColor: prefs.font_size_base === s.value ? "hsl(var(--accent))" : "hsl(var(--border))",
                    background: prefs.font_size_base === s.value ? "hsl(var(--accent) / 0.08)" : "transparent",
                    color: prefs.font_size_base === s.value ? "hsl(var(--accent))" : "hsl(var(--foreground))",
                  }}
                >
                  <span className="text-xs font-medium">{s.label}</span>
                  <span className="font-semibold" style={{ fontSize: `${s.value}px`, fontFamily: prefs.font_family }}>
                    Aa
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold block mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
              TAILLE DES TITRES
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {HEADING_SIZES.map(s => (
                <button
                  key={s.value}
                  onClick={() => updatePrefs({ font_size_heading: s.value })}
                  className="flex flex-col items-center py-3 rounded-lg border transition-all"
                  style={{
                    borderColor: prefs.font_size_heading === s.value ? "hsl(var(--primary))" : "hsl(var(--border))",
                    background: prefs.font_size_heading === s.value ? "hsl(var(--primary) / 0.08)" : "transparent",
                    color: prefs.font_size_heading === s.value ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                  }}
                >
                  <span className="font-bold" style={{ fontSize: `${Math.max(12, +s.value * 0.5)}px`, fontFamily: "Poppins" }}>
                    T
                  </span>
                  <span className="text-xs mt-1">{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        {/* Layout */}
        <div className={section.replace("mb-4", "")} style={cardStyle}>
          <SectionHeader icon={<Layout size={16} />} title="Mise en page" subtitle="Arrondis des éléments" />
          <div className="grid grid-cols-3 gap-1.5">
            {RADII.map(r => (
              <button
                key={r.value}
                onClick={() => updatePrefs({ border_radius: r.value })}
                className="flex flex-col items-center py-2.5 px-1 rounded-lg border transition-all gap-1.5"
                style={{
                  borderColor: prefs.border_radius === r.value ? "hsl(var(--accent))" : "hsl(var(--border))",
                  background: prefs.border_radius === r.value ? "hsl(var(--accent) / 0.08)" : "transparent",
                }}
              >
                <div
                  className="w-7 h-7 border-2"
                  style={{
                    borderColor: prefs.border_radius === r.value ? "hsl(var(--accent))" : "hsl(var(--border))",
                    borderRadius: `${r.value}px`,
                    background: prefs.border_radius === r.value ? "hsl(var(--accent) / 0.15)" : "transparent",
                  }}
                />
                <span className="text-[10px] text-center leading-tight" style={{ color: prefs.border_radius === r.value ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))" }}>
                  {r.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* NOUVEAU — Densité */}
        <div className={section.replace("mb-4", "")} style={cardStyle}>
          <SectionHeader icon={<Sliders size={16} />} title="Densité" subtitle="Espacement listes/tableaux" nouveau />
          <div className="flex flex-col gap-1.5">
            {DENSITES.map(d => (
              <button
                key={d.value}
                onClick={() => updatePrefs({ density: d.value })}
                className="flex flex-col items-start px-3 py-2 rounded-lg border transition-all text-left gap-0.5"
                style={{
                  borderColor: prefs.density === d.value ? "hsl(var(--accent))" : "hsl(var(--border))",
                  background: prefs.density === d.value ? "hsl(var(--accent) / 0.08)" : "transparent",
                }}
              >
                <span className="text-sm font-semibold" style={{ color: prefs.density === d.value ? "hsl(var(--accent))" : "hsl(var(--foreground))" }}>{d.label}</span>
                <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>{d.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* NOUVEAU — Ombres */}
        <div className={section.replace("mb-4", "")} style={cardStyle}>
          <SectionHeader icon={<Square size={16} />} title="Style des ombres" subtitle="Profondeur des cartes" nouveau />
          <div className="grid grid-cols-4 gap-1.5">
            {OMBRES.map(o => (
              <button
                key={o.value}
                onClick={() => updatePrefs({ shadow_style: o.value })}
                className="flex flex-col items-center gap-2 py-3 rounded-lg border transition-all"
                style={{
                  borderColor: prefs.shadow_style === o.value ? "hsl(var(--accent))" : "hsl(var(--border))",
                  background: prefs.shadow_style === o.value ? "hsl(var(--accent) / 0.08)" : "transparent",
                }}
              >
                <div className="w-8 h-6 rounded-md bg-white" style={{ boxShadow: o.css }} />
                <span className="text-[10px]" style={{ color: prefs.shadow_style === o.value ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))" }}>{o.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Live Preview */}
      <div className={section} style={cardStyle}>
        <SectionHeader icon={<Eye size={16} />} title="Aperçu en temps réel" subtitle="Voici un aperçu de vos paramètres actuels" />
        <div className="rounded-xl overflow-hidden border" style={{ borderColor: "hsl(var(--border))", boxShadow: ombreActuelle }}>
          <div className="flex" style={{ height: "140px" }}>
            <div className="w-14 flex flex-col items-center gap-3 py-3" style={{ background: prefs.sidebar_color }}>
              <div className="w-7 h-7 rounded-lg" style={{ background: prefs.secondary_color }} />
              {[prefs.accent_color, prefs.secondary_color, prefs.primary_color].map((c, i) => (
                <div key={i} className="w-6 h-1.5 rounded-full opacity-60" style={{ background: c }} />
              ))}
            </div>
            <div className="flex-1 p-4" style={{ background: prefs.background_color }}>
              <div className="mb-3">
                <div className="h-4 rounded mb-1 w-28" style={{ background: prefs.primary_color, borderRadius: `${prefs.border_radius}px` }} />
                <div className="h-2.5 rounded w-40 opacity-30" style={{ background: prefs.primary_color, borderRadius: `${prefs.border_radius}px` }} />
              </div>
              <div className="flex gap-2 mb-3 flex-wrap">
                <div className="px-3 py-1.5 font-semibold" style={{
                  background: prefs.primary_color, color: "white",
                  borderRadius: `${prefs.border_radius}px`,
                  fontSize: `${prefs.font_size_base}px`,
                  fontFamily: prefs.font_family
                }}>
                  Valider
                </div>
                <div className="px-3 py-1.5 font-semibold" style={{
                  background: prefs.accent_color, color: "white",
                  borderRadius: `${prefs.border_radius}px`,
                  fontSize: `${prefs.font_size_base}px`,
                  fontFamily: prefs.font_family
                }}>
                  Action
                </div>
                <div className="px-3 py-1.5 font-semibold" style={{
                  background: `${prefs.success_color ?? defaults.success_color}20`, color: prefs.success_color ?? defaults.success_color,
                  borderRadius: `${prefs.border_radius}px`,
                  fontSize: `${prefs.font_size_base}px`,
                  fontFamily: prefs.font_family,
                  border: `1px solid ${prefs.success_color ?? defaults.success_color}50`,
                }}>
                  Validé
                </div>
                <div className="px-3 py-1.5 font-semibold" style={{
                  background: `${prefs.warning_color ?? defaults.warning_color}20`, color: prefs.warning_color ?? defaults.warning_color,
                  borderRadius: `${prefs.border_radius}px`,
                  fontSize: `${prefs.font_size_base}px`,
                  fontFamily: prefs.font_family,
                  border: `1px solid ${prefs.warning_color ?? defaults.warning_color}50`,
                }}>
                  En attente
                </div>
              </div>
              <p style={{ fontFamily: prefs.font_family, fontSize: `${prefs.font_size_base}px`, color: prefs.primary_color, opacity: 0.6 }}>
                Texte de l'interface avec la police {prefs.font_family}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => updatePrefs(defaults)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium border transition-all hover:bg-red-50"
          style={{ borderColor: "hsl(0 84% 85%)", color: "hsl(0 84% 55%)" }}
        >
          <RotateCcw size={14} />
          Réinitialiser (ANTHRO-SYS)
        </button>
        <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
          Les modifications sont sauvegardées automatiquement
        </p>
      </div>
    </div>
  );
};

export default AppearancePage;
