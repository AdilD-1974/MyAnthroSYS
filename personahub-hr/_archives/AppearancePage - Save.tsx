import React from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { Palette, Type, Layout, RotateCcw, Eye } from "lucide-react";

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
  { name: "Merriweather", label: "Merriweather", category: "Sérif classique" },
  { name: "Playfair Display", label: "Playfair", category: "Sérif éditorial" },
  { name: "Ubuntu", label: "Ubuntu", category: "Technique" },
];

const FONT_SIZES = [
  { value: "11", label: "Très petit (11px)" },
  { value: "12", label: "Petit (12px)" },
  { value: "13", label: "Réduit (13px)" },
  { value: "14", label: "Normal (14px)" },
  { value: "15", label: "Confort (15px)" },
  { value: "16", label: "Grand (16px)" },
  { value: "17", label: "Très grand (17px)" },
  { value: "18", label: "Maxi (18px)" },
];

const HEADING_SIZES = [
  { value: "16", label: "16px" },
  { value: "18", label: "18px" },
  { value: "20", label: "20px" },
  { value: "22", label: "22px" },
  { value: "24", label: "24px" },
  { value: "26", label: "26px" },
  { value: "28", label: "28px" },
  { value: "30", label: "30px" },
  { value: "32", label: "32px" },
  { value: "36", label: "36px" },
];

const RADII = [
  { value: "0", label: "Carré" },
  { value: "4", label: "Léger" },
  { value: "6", label: "Doux" },
  { value: "8", label: "Standard" },
  { value: "12", label: "Arrondi" },
  { value: "16", label: "Large" },
  { value: "24", label: "Pill" },
];

const COLOR_PRESETS = [
  { name: "ANTHRO-SYS (défaut)", primary: "#0E3D5C", sidebar: "#0A2E44", secondary: "#34A1A1", accent: "#1DCFCF", bg: "#F1F6F8" },
  { name: "Ardoise & Émeraude", primary: "#1E3A5F", sidebar: "#152B47", secondary: "#2ECC71", accent: "#3498DB", bg: "#F0F4F8" },
  { name: "Bordeaux & Or", primary: "#6B1A1A", sidebar: "#4A0E0E", secondary: "#C9A84C", accent: "#E8C547", bg: "#FAF7F0" },
  { name: "Gris ardoise", primary: "#2D3748", sidebar: "#1A202C", secondary: "#68D391", accent: "#63B3ED", bg: "#F7FAFC" },
  { name: "Violet professionnel", primary: "#4C1D95", sidebar: "#3B0764", secondary: "#7C3AED", accent: "#A78BFA", bg: "#F5F3FF" },
  { name: "Minuit Exécutif", primary: "#1E2761", sidebar: "#141A42", secondary: "#4A90D9", accent: "#CADCFC", bg: "#F4F6FB" },
  { name: "Forêt & Mousse", primary: "#2C5F2D", sidebar: "#1A3A1B", secondary: "#97BC62", accent: "#4CAF50", bg: "#F4F9F4" },
  { name: "Corail & Marine", primary: "#2F3C7E", sidebar: "#1E2755", secondary: "#F96167", accent: "#F9E795", bg: "#F8F8FC" },
  { name: "Terracotta Chaleureux", primary: "#B85042", sidebar: "#7A3430", secondary: "#A7BEAE", accent: "#E7E8D1", bg: "#FDF6F5" },
  { name: "Océan Profond", primary: "#065A82", sidebar: "#033D59", secondary: "#02C39A", accent: "#1C7293", bg: "#F0F7FA" },
  { name: "Anthracite & Or", primary: "#36454F", sidebar: "#1E2B33", secondary: "#C9A84C", accent: "#F0B429", bg: "#F5F5F5" },
  { name: "Sarcelle & Menthe", primary: "#028090", sidebar: "#015A66", secondary: "#02C39A", accent: "#00A896", bg: "#F0FAFA" },
  { name: "Baie & Crème", primary: "#6D2E46", sidebar: "#4A1E30", secondary: "#A26769", accent: "#E8A598", bg: "#FDF5F0" },
  { name: "Sauge & Naturel", primary: "#50808E", sidebar: "#375A63", secondary: "#84B59F", accent: "#69A297", bg: "#F3F7F6" },
  { name: "Cerise & Blanc", primary: "#990011", sidebar: "#660009", secondary: "#2F3C7E", accent: "#CC3344", bg: "#FFF8F8" },
  { name: "Nuit Tropicale", primary: "#0A3D62", sidebar: "#061E31", secondary: "#F8B739", accent: "#60A3D9", bg: "#EFF6FC" },
  { name: "Sépia Classique", primary: "#704214", sidebar: "#4A2B0D", secondary: "#C9A96E", accent: "#D4823A", bg: "#FBF5EC" },
  { name: "Prune & Lavande", primary: "#3D1C72", sidebar: "#28124D", secondary: "#8A7FBB", accent: "#C3B8E8", bg: "#F6F4FD" },
  { name: "Vert Militaire", primary: "#3B4A3F", sidebar: "#242E28", secondary: "#7B9E7F", accent: "#A8C5A0", bg: "#F2F5F2" },
  { name: "Marine & Saumon", primary: "#1A3C5E", sidebar: "#0F2540", secondary: "#E07B6A", accent: "#F4A58A", bg: "#F5F8FC" },
];

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

const SectionHeader: React.FC<{ icon: React.ReactNode; title: string; subtitle?: string }> = ({ icon, title, subtitle }) => (
  <div className="flex items-start gap-3 mb-5">
    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }}>
      {icon}
    </div>
    <div>
      <h2 className="text-base font-bold" style={{ fontFamily: "Poppins, sans-serif" }}>{title}</h2>
      {subtitle && <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{subtitle}</p>}
    </div>
  </div>
);

const AppearancePage: React.FC = () => {
  const { prefs, updatePrefs } = useTheme();

  const defaults = {
    primary_color: "#0E3D5C",
    secondary_color: "#34A1A1",
    accent_color: "#1DCFCF",
    background_color: "#F1F6F8",
    sidebar_color: "#0A2E44",
    font_family: "Inter",
    font_size_base: "14",
    font_size_heading: "24",
    border_radius: "8",
  };

  const applyPreset = (preset: typeof COLOR_PRESETS[0]) => {
    updatePrefs({
      primary_color: preset.primary,
      sidebar_color: preset.sidebar,
      secondary_color: preset.secondary,
      accent_color: preset.accent,
      background_color: preset.bg,
    });
  };

  const section = "rounded-xl p-6 mb-4";
  const cardStyle = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", boxShadow: "var(--shadow-sm)" };

  return (
    <div className="p-6 max-w-2xl">
      <div className="page-header">
        <h1 className="page-title">Apparence</h1>
        <p className="page-subtitle">Personnalisez entièrement l'interface selon vos préférences</p>
      </div>

      {/* Color Presets */}
      <div className={section} style={cardStyle}>
        <SectionHeader icon={<Palette size={16} />} title="Palettes prédéfinies" subtitle="Appliquez un thème complet en un clic" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {COLOR_PRESETS.map(preset => (
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
              <span className="text-sm font-medium">{preset.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Colors */}
      <div className={section} style={cardStyle}>
        <SectionHeader icon={<Palette size={16} />} title="Couleurs personnalisées" subtitle="Cliquez sur un carré de couleur pour modifier" />
        <ColorSwatch label="Couleur principale" value={prefs.primary_color} onChange={v => updatePrefs({ primary_color: v })} hint="Boutons, en-têtes, éléments clés" />
        <ColorSwatch label="Barre latérale" value={prefs.sidebar_color} onChange={v => updatePrefs({ sidebar_color: v })} hint="Fond du menu de navigation" />
        <ColorSwatch label="Couleur secondaire" value={prefs.secondary_color} onChange={v => updatePrefs({ secondary_color: v })} hint="Badges, indicateurs de succès" />
        <ColorSwatch label="Couleur d'accentuation" value={prefs.accent_color} onChange={v => updatePrefs({ accent_color: v })} hint="Liens, focus, surbrillance" />
        <ColorSwatch label="Couleur de fond" value={prefs.background_color} onChange={v => updatePrefs({ background_color: v })} hint="Arrière-plan général de l'application" />
      </div>

      {/* Typography - Font Family */}
      <div className={section} style={cardStyle}>
        <SectionHeader icon={<Type size={16} />} title="Police de caractères" subtitle="Choisissez la typographie de l'interface" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {FONTS.map(f => (
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
              <span className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))", fontFamily: "Inter" }}>
                {f.category}
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

      {/* Typography - Sizes */}
      <div className={section} style={cardStyle}>
        <SectionHeader icon={<Type size={16} />} title="Tailles de texte" subtitle="Ajustez la hiérarchie typographique" />

        <div className="mb-5">
          <label className="text-xs font-semibold block mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
            TAILLE DU TEXTE COURANT
          </label>
          <div className="flex flex-col gap-1.5">
            {FONT_SIZES.map(s => (
              <button
                key={s.value}
                onClick={() => updatePrefs({ font_size_base: s.value })}
                className="flex items-center justify-between px-4 py-2.5 rounded-lg border transition-all"
                style={{
                  borderColor: prefs.font_size_base === s.value ? "hsl(var(--accent))" : "hsl(var(--border))",
                  background: prefs.font_size_base === s.value ? "hsl(var(--accent) / 0.08)" : "transparent",
                  color: prefs.font_size_base === s.value ? "hsl(var(--accent))" : "hsl(var(--foreground))",
                }}
              >
                <span className="text-sm font-medium">{s.label}</span>
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
          <div className="grid grid-cols-5 gap-1.5">
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

      {/* Layout */}
      <div className={section} style={cardStyle}>
        <SectionHeader icon={<Layout size={16} />} title="Mise en page" subtitle="Arrondis des éléments de l'interface" />
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {RADII.map(r => (
            <button
              key={r.value}
              onClick={() => updatePrefs({ border_radius: r.value })}
              className="flex flex-col items-center py-3 px-2 rounded-lg border transition-all gap-2"
              style={{
                borderColor: prefs.border_radius === r.value ? "hsl(var(--accent))" : "hsl(var(--border))",
                background: prefs.border_radius === r.value ? "hsl(var(--accent) / 0.08)" : "transparent",
              }}
            >
              <div
                className="w-8 h-8 border-2"
                style={{
                  borderColor: prefs.border_radius === r.value ? "hsl(var(--accent))" : "hsl(var(--border))",
                  borderRadius: `${r.value}px`,
                  background: prefs.border_radius === r.value ? "hsl(var(--accent) / 0.15)" : "transparent",
                }}
              />
              <span className="text-xs text-center leading-tight" style={{ color: prefs.border_radius === r.value ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))" }}>
                {r.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Live Preview */}
      <div className={section} style={cardStyle}>
        <SectionHeader icon={<Eye size={16} />} title="Aperçu en temps réel" subtitle="Voici un aperçu de vos paramètres actuels" />
        <div className="rounded-xl overflow-hidden border" style={{ borderColor: "hsl(var(--border))" }}>
          {/* Mini sidebar */}
          <div className="flex" style={{ height: "140px" }}>
            <div className="w-14 flex flex-col items-center gap-3 py-3" style={{ background: prefs.sidebar_color }}>
              <div className="w-7 h-7 rounded-lg" style={{ background: prefs.secondary_color }} />
              {[prefs.accent_color, prefs.secondary_color, prefs.primary_color].map((c, i) => (
                <div key={i} className="w-6 h-1.5 rounded-full opacity-60" style={{ background: c }} />
              ))}
            </div>
            {/* Mini content */}
            <div className="flex-1 p-4" style={{ background: prefs.background_color }}>
              <div className="mb-3">
                <div className="h-4 rounded mb-1 w-28" style={{ background: prefs.primary_color, borderRadius: `${prefs.border_radius}px` }} />
                <div className="h-2.5 rounded w-40 opacity-30" style={{ background: prefs.primary_color, borderRadius: `${prefs.border_radius}px` }} />
              </div>
              <div className="flex gap-2 mb-3">
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
                  background: `${prefs.secondary_color}20`, color: prefs.secondary_color,
                  borderRadius: `${prefs.border_radius}px`,
                  fontSize: `${prefs.font_size_base}px`,
                  fontFamily: prefs.font_family,
                  border: `1px solid ${prefs.secondary_color}50`,
                }}>
                  Badge
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
