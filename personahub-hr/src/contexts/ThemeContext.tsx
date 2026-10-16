// ============================================================
// ThemeContext.tsx — src/contexts/ThemeContext.tsx
// ------------------------------------------------------------
// Préférences d'apparence persistées EN BASE, par utilisateur,
// via le CRUD générique /db/user_theme_prefs (lib/api → db).
//   • localStorage conservé comme simple cache anti-flash.
//   • La base reste la source de vérité (portable multi-postes).
//   • Écriture debouncée (600 ms) pour ne pas saturer l'API
//     pendant les réglages au color-picker.
//
// L'interface ThemePrefs et la signature updatePrefs sont
// INCHANGÉES → AppearancePage continue de marcher tel quel.
// ============================================================

import React, {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from "react";
import { db } from "@/lib/api";
import { useAuth } from "./AuthContext";

interface ThemePrefs {
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  background_color: string;
  font_family: string;
  font_size_base: string;
  font_size_heading: string;
  border_radius: string;
  sidebar_color: string;
  // ── Champs "Nouveau" côté AppearancePage — désormais persistés et
  // appliqués ici (auparavant lus/écrits via `as any`, donc perdus au
  // rechargement puisque absents de ThemePrefs / CLES / de l'effet CSS).
  success_color: string;
  warning_color: string;
  danger_color: string;
  font_family_heading: string;
  density: string;
  shadow_style: string;
}

const defaults: ThemePrefs = {
  primary_color: "#0E3D5C",
  secondary_color: "#34A1A1",
  accent_color: "#1DCFCF",
  background_color: "#F1F6F8",
  font_family: "Inter",
  font_size_base: "14",
  font_size_heading: "24",
  border_radius: "8",
  sidebar_color: "#0A2E44",
  success_color: "#1E8E5A",
  warning_color: "#D97706",
  danger_color: "#DC2626",
  font_family_heading: "Poppins",
  density: "confortable",
  shadow_style: "standard",
};

// Ombres correspondant aux options de AppearancePage (OMBRES) — dupliquées
// ici volontairement : ThemeContext ne doit pas dépendre d'un composant page.
const OMBRES_CSS: Record<string, string> = {
  aucune: "none",
  legere: "0 1px 2px rgba(0,0,0,0.06)",
  standard: "0 2px 8px rgba(0,0,0,0.10)",
  marquee: "0 8px 24px rgba(0,0,0,0.16)",
};

// Échelle d'espacement par densité, consommée par le CSS global via
// var(--space-scale) (ex. padding: calc(12px * var(--space-scale))).
const DENSITE_SCALE: Record<string, string> = {
  compact: "0.8",
  confortable: "1",
  spacieuse: "1.25",
};

const TABLE = "user_theme_prefs";
const CLES: (keyof ThemePrefs)[] = [
  "primary_color", "secondary_color", "accent_color", "background_color",
  "sidebar_color", "font_family", "font_size_base", "font_size_heading",
  "border_radius",
  "success_color", "warning_color", "danger_color",
  "font_family_heading", "density", "shadow_style",
];

interface ThemeContextType {
  prefs: ThemePrefs;
  updatePrefs: (p: Partial<ThemePrefs>) => Promise<void>;
  loading: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  prefs: defaults, updatePrefs: async () => {}, loading: false,
});

export const useTheme = () => useContext(ThemeContext);

// Ne garde que les champs ThemePrefs (ignore id, user_id, *_at)
function extraire(row: Record<string, unknown>): Partial<ThemePrefs> {
  const out: Partial<ThemePrefs> = {};
  CLES.forEach((k) => {
    const v = row[k];
    if (v !== null && v !== undefined) (out as Record<string, unknown>)[k] = v;
  });
  return out;
}

function hexToHSL(hex: string): string {
  let r = 0, g = 0, b = 0;
  if (hex.length === 7) {
    r = parseInt(hex.slice(1, 3), 16) / 255;
    g = parseInt(hex.slice(3, 5), 16) / 255;
    b = parseInt(hex.slice(5, 7), 16) / 255;
  }
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<ThemePrefs>(defaults);
  const [loading, setLoading] = useState(false);

  const existeRef = useRef(false);                 // ligne en base déjà créée ?
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  // ── Chargement : cache local (instantané) puis base (vérité) ──
  useEffect(() => {
    if (!user) { setPrefs(defaults); existeRef.current = false; return; }
    let annule = false;

    // 1) cache local pour éviter le flash au chargement
    try {
      const cache = localStorage.getItem(`theme_${user.id}`);
      if (cache) setPrefs({ ...defaults, ...JSON.parse(cache) });
    } catch { /* cache corrompu : ignoré */ }

    // 2) source de vérité : la base
    (async () => {
      setLoading(true);
      try {
        const row = await db.findOne<Record<string, unknown>>(TABLE, { user_id: user.id });
        if (row && !annule) {
          existeRef.current = true;
          const merged = { ...defaults, ...extraire(row) };
          setPrefs(merged);
          localStorage.setItem(`theme_${user.id}`, JSON.stringify(merged));
        } else if (!annule) {
          existeRef.current = false;
        }
      } catch (e) {
        console.error("[ThemeContext] chargement des préférences :", e);
      } finally {
        if (!annule) setLoading(false);
      }
    })();

    return () => { annule = true; };
  }, [user]);

  // ── Application des variables CSS ─────────────────────────
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--primary", hexToHSL(prefs.primary_color));
    root.style.setProperty("--sidebar-background", hexToHSL(prefs.sidebar_color));
    root.style.setProperty("--secondary", hexToHSL(prefs.secondary_color));
    root.style.setProperty("--accent", hexToHSL(prefs.accent_color));
    root.style.setProperty("--background", hexToHSL(prefs.background_color));
    root.style.setProperty("--radius", `${prefs.border_radius}px`);
    root.style.setProperty("--font-size-base", `${prefs.font_size_base}px`);
    root.style.setProperty("--font-size-heading", `${prefs.font_size_heading}px`);
    // Facteur d'échelle utilisé par les tailles de police codées en "px fixes"
    // dans les écrans (via calc(Npx * var(--font-scale))), pour qu'elles suivent
    // elles aussi la préférence "Apparence" du collaborateur (base par défaut : 14px).
    root.style.setProperty("--font-scale", String(parseFloat(prefs.font_size_base) / 14 || 1));
    document.body.style.fontFamily = `'${prefs.font_family}', sans-serif`;
    document.body.style.fontSize = `${prefs.font_size_base}px`;

    // ── Couleurs de statut — badges/alertes "Validé / En attente / Erreur" ──
    root.style.setProperty("--success", hexToHSL(prefs.success_color));
    root.style.setProperty("--warning", hexToHSL(prefs.warning_color));
    root.style.setProperty("--danger", hexToHSL(prefs.danger_color));

    // ── Police des titres — distincte du texte courant si renseignée.
    // Le CSS global doit utiliser `font-family: var(--font-family-heading)`
    // sur h1..h6 (ou classes .page-title / .section-title) pour en bénéficier ;
    // ce Provider expose la variable, il n'impose pas où elle s'applique.
    root.style.setProperty("--font-family-heading", `'${prefs.font_family_heading || prefs.font_family}', sans-serif`);

    // ── Densité — exposée en variable ET en attribut data-* pour permettre
    // soit du CSS calc(var(--space-scale)), soit du ciblage [data-density=...].
    root.style.setProperty("--space-scale", DENSITE_SCALE[prefs.density] ?? "1");
    root.setAttribute("data-density", prefs.density || "confortable");

    // ── Style d'ombre — variable CSS consommable via box-shadow: var(--shadow-app).
    root.style.setProperty("--shadow-app", OMBRES_CSS[prefs.shadow_style] ?? OMBRES_CSS.standard);
    root.setAttribute("data-shadow", prefs.shadow_style || "standard");
  }, [prefs]);

  // ── Persistance debouncée en base (+ cache local) ─────────
  const persister = useCallback((data: ThemePrefs) => {
    if (!user) return;
    localStorage.setItem(`theme_${user.id}`, JSON.stringify(data));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        if (existeRef.current) {
          await db.update(TABLE, { user_id: user.id }, data);
        } else {
          await db.create(TABLE, { user_id: user.id, ...data });
          existeRef.current = true;
        }
      } catch (e) {
        console.error("[ThemeContext] sauvegarde des préférences :", e);
      }
    }, 600);
  }, [user]);

  const updatePrefs = async (p: Partial<ThemePrefs>) => {
    setPrefs((prev) => {
      const updated = { ...prev, ...p };
      persister(updated);
      return updated;
    });
  };

  return (
    <ThemeContext.Provider value={{ prefs, updatePrefs, loading }}>
      {children}
    </ThemeContext.Provider>
  );
};
