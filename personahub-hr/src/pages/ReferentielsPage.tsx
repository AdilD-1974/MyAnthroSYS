import React, { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import {
  Search, Plus, Pencil, Trash2, Check, X,
  ChevronDown, ChevronUp, ExternalLink, Upload, Download, AlertTriangle, FileSpreadsheet, Copy,
} from "lucide-react";

/* ─────────────────── Types ─────────────────── */
interface RefGroup {
  label: string;
  icon: string;
  color: string;
  tables: TableDef[];
}

interface FieldDef {
  key: string;
  label: string;
  type?: "text" | "number" | "boolean" | "select" | "date" | "color";
  refTable?: string;
  refValueCol?: string;
  refLabelCol?: string;
  width?: string;
}

/* ─────────────────── Palette de couleurs ─────────────────── */
// RG-UO-COULEUR-01 (Adil DAIA) : Palette de couleurs pour les types d'UO
const COLOR_PALETTE = [
  // Bleus
  "#3B82F6", "#2563EB", "#1D4ED8", "#60A5FA", "#93C5FD",
  // Indigos / Violets
  "#6366F1", "#4F46E5", "#7C3AED", "#8B5CF6", "#A78BFA",
  // Roses / Rouges
  "#EC4899", "#DB2777", "#EF4444", "#DC2626", "#F87171",
  // Oranges / Ambrés
  "#F97316", "#EA580C", "#F59E0B", "#D97706", "#FCD34D",
  // Verts
  "#22C55E", "#16A34A", "#059669", "#10B981", "#6EE7B7",
  // Teals / Cyans
  "#14B8A6", "#0D9488", "#06B6D4", "#0891B2", "#67E8F9",
  // Grises / Neutres
  "#64748B", "#475569", "#6B7280", "#374151", "#9CA3AF",
  // Marrons / Spéciaux
  "#92400E", "#78350F", "#7F1D1D", "#1E3A5F", "#312E81",
];

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

const ColorPicker: React.FC<ColorPickerProps> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 6, padding: "3px 8px",
          borderRadius: 6, border: "1px solid hsl(var(--border))",
          background: "hsl(var(--background))", cursor: "pointer",
          fontSize: 11, color: "hsl(var(--foreground))"
        }}
      >
        <span style={{ width: 16, height: 16, borderRadius: 4, background: value || "#6366F1", border: "1px solid hsl(var(--border) / 0.5)", flexShrink: 0 }} />
        {value || "Choisir…"}
        <ChevronDown size={11} style={{ color: "hsl(var(--muted-foreground))", transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }} />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
          background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))",
          borderRadius: 10, padding: 10, boxShadow: "0 8px 24px hsl(0 0% 0% / 0.15)",
          width: 200,
        }}>
          <p style={{ margin: "0 0 8px", fontSize: 10, fontWeight: 600, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Palette de couleurs
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 4 }}>
            {COLOR_PALETTE.map(color => (
              <button
                key={color}
                type="button"
                title={color}
                onClick={() => { onChange(color); setOpen(false); }}
                style={{
                  width: 20, height: 20, borderRadius: 4, background: color,
                  border: value === color ? "2px solid hsl(var(--foreground))" : "1px solid transparent",
                  cursor: "pointer", outline: "none", transition: "transform 0.1s",
                  transform: value === color ? "scale(1.2)" : "scale(1)",
                }}
              />
            ))}
          </div>
          {/* Option saisie libre */}
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="color"
              value={value || "#6366F1"}
              onChange={e => onChange(e.target.value)}
              title="Couleur personnalisée"
              style={{ width: 28, height: 24, border: "none", padding: 0, borderRadius: 4, cursor: "pointer", background: "none" }}
            />
            <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>Couleur personnalisée</span>
          </div>
        </div>
      )}
    </div>
  );
};

interface TableDef {
  key: string;
  label: string;
  hasOrdre?: boolean;
  hasDescription?: boolean;
  fields?: FieldDef[];
}

/* ─────────────────── Config référentiels ─────────────────── */
const REF_GROUPS: RefGroup[] = [
  {
    label: "Contrats & Emploi",
    icon: "📋",
    color: "hsl(197 100% 42%)",
    tables: [
      {
        key: "ref_type_contrat", label: "Types de contrat",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "duree_requise", label: "Durée requise", type: "boolean", width: "w-20" },
          { key: "duree_defaut_valeur", label: "Durée par défaut", type: "number", width: "w-20" },
          { key: "code_unite_duree_defaut", label: "Unité (J/M/A)", width: "w-20" },
          { key: "a_titularisation", label: "Titularisation", type: "boolean", width: "w-20" },
          { key: "auto_cloture", label: "Auto-clôture", type: "boolean", width: "w-20" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_statut_contrat", label: "Statuts de contrat",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_unite_duree_contrat", label: "Unités de durée contrat",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_motif_recrutement", label: "Motifs de recrutement",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_source_recrutement", label: "Sources de recrutement",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_motif_rupture", label: "Motifs de rupture",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_motif_sortie", label: "Motifs de sortie",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_motif_affectation", label: "Motifs d'affectation",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_type_temps", label: "Types de temps de travail",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
    ],
  },
  {
    label: "Classement & Hiérarchie",
    icon: "🏅",
    color: "hsl(213 73% 35%)",
    tables: [
      {
        key: "ref_categorie_emploi", label: "Catégories d'emploi",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_categorie_professionnelle", label: "Catégories professionnelles",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_classification", label: "Classifications",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_niveau_qualification", label: "Niveaux de qualification",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_qualification", label: "Qualifications",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_coefficient", label: "Coefficients",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "valeur", label: "Valeur", type: "number", width: "w-20" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_echelle", label: "Échelles",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_classe", label: "Classes",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_echelon", label: "Échelons",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_motif_classification", label: "Motifs de classification",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
    ],
  },
  {
    label: "Métiers & Postes",
    icon: "💼",
    color: "hsl(280 55% 50%)",
    tables: [
      {
        key: "ref_famille_metier", label: "Familles de métiers",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_metier", label: "Métiers",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          {
            key: "code_famille", label: "Famille", type: "select",
            refTable: "ref_famille_metier", refValueCol: "code", refLabelCol: "libelle",
          },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_emploi", label: "Emplois",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          {
            key: "code_metier", label: "Métier", type: "select",
            refTable: "ref_metier", refValueCol: "code", refLabelCol: "libelle",
          },
          {
            key: "code_classification", label: "Classification", type: "select",
            refTable: "ref_classification", refValueCol: "code", refLabelCol: "libelle",
          },
          { key: "description", label: "Description" },
          // RG-EMP-01 (Adil DAIA) : Indicateur emploi de responsabilité
          { key: "est_emploi_responsabilite", label: "Responsabilité", type: "boolean", width: "w-28" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_fonction", label: "Fonctions",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_filiere", label: "Filières",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_grade", label: "Grades",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_responsabilite", label: "Responsabilités",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_activite", label: "Activités",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_motif_classification", label: "Motifs de classification",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
    ],
  },
  {
    label: "Personnes & Identité",
    icon: "👤",
    color: "hsl(84 55% 46%)",
    tables: [
      {
        key: "ref_genre", label: "Genres",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_situation_familiale", label: "Situations familiales",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_lien_parente", label: "Liens de parenté",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_type_handicap", label: "Types de handicap",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
    ],
  },
  {
    label: "Géographie",
    icon: "🗺️",
    color: "hsl(39 95% 50%)",
    tables: [
      {
        key: "ref_pays", label: "Pays",
        fields: [
          { key: "code", label: "Code (alpha3)", width: "w-24" },
          { key: "code_pays_alpha2", label: "Alpha2", width: "w-16" },
          { key: "code_pays_num", label: "Num", type: "number", width: "w-16" },
          { key: "libelle", label: "Libellé" },
          { key: "continent", label: "Continent", width: "w-28" },
          { key: "devise", label: "Devise", width: "w-20" },
          { key: "langue_principale", label: "Langue", width: "w-28" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_nationalite", label: "Nationalités",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_region", label: "Régions",
        fields: [
          { key: "code", label: "Code", width: "w-20" },
          { key: "libelle", label: "Libellé" },
          {
            key: "code_pays", label: "Pays", type: "select",
            refTable: "ref_pays", refValueCol: "code", refLabelCol: "libelle",
          },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_ville", label: "Villes",
        fields: [
          { key: "code", label: "Code", width: "w-20" },
          { key: "libelle", label: "Libellé" },
          {
            key: "code_region", label: "Région", type: "select",
            refTable: "ref_region", refValueCol: "code", refLabelCol: "libelle",
          },
          { key: "code_postal", label: "Code postal", width: "w-24" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_commune", label: "Communes",
        fields: [
          { key: "code", label: "Code INSEE", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "code_postal", label: "Code postal", width: "w-24" },
          {
            key: "code_ville", label: "Ville", type: "select",
            refTable: "ref_ville", refValueCol: "code", refLabelCol: "libelle",
          },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
    ],
  },
  {
    label: "Compétences & Formation",
    icon: "🎓",
    color: "hsl(260 60% 52%)",
    tables: [
      {
        key: "ref_type_diplome", label: "Diplômes Référence",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "code_niveau_diplome", label: "Niveau", type: "select", refTable: "ref_niveau_diplome", refValueCol: "code", refLabelCol: "libelle" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_filiere_diplome", label: "Filières de diplôme",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_specialite_diplome", label: "Spécialités de diplôme",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "code_filiere", label: "Filière", type: "select", refTable: "ref_filiere_diplome", refValueCol: "code", refLabelCol: "libelle" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_niveau_diplome", label: "Niveaux de diplôme",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "rang", label: "Rang", type: "number", width: "w-16" },
          { key: "nombre_annees", label: "Nb années", type: "number", width: "w-20" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_type_etablissement", label: "Types d'établissement",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_domaine_formation", label: "Domaines de formation",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_type_formation", label: "Types de formation",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_organisme_formation", label: "Organismes de formation",
        fields: [
          { key: "nom", label: "Nom" },
          { key: "siret", label: "SIRET", width: "w-32" },
          { key: "numero_datadock", label: "N° DataDock", width: "w-28" },
          { key: "contact", label: "Contact" },
          { key: "email", label: "Email" },
          { key: "telephone", label: "Téléphone", width: "w-28" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_type_competence", label: "Types de compétence",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_competence", label: "Compétences",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "code_type_competence", label: "Type", type: "select", refTable: "ref_type_competence", refValueCol: "code", refLabelCol: "libelle" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_niveau_competence", label: "Niveaux de compétence",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "poids", label: "Poids", type: "number", width: "w-16" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
    ],
  },
  {
    label: "Paie & Rémunération",
    icon: "💰",
    color: "hsl(157 60% 38%)",
    tables: [
      {
        key: "ref_type_remuneration", label: "Types de rémunération",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "nature", label: "Nature", width: "w-24" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_rubrique_paie", label: "Rubriques de paie",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "type", label: "Type", width: "w-24" },
          { key: "sens", label: "Sens", width: "w-20" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_avantage", label: "Avantages",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "pris_en_compte_paie", label: "Paie", type: "boolean", width: "w-16" },
          { key: "pris_en_net", label: "Net", type: "boolean", width: "w-16" },
          {
            key: "code_rubrique", label: "Rubrique", type: "select",
            refTable: "ref_rubrique_paie", refValueCol: "code", refLabelCol: "libelle",
          },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_taux_cotisation", label: "Taux de cotisation",
        fields: [
          { key: "libelle", label: "Libellé" },
          {
            key: "code_organisme", label: "Organisme", type: "select",
            refTable: "ref_organisme_social", refValueCol: "code", refLabelCol: "libelle",
          },
          { key: "taux_salarial", label: "Tx salarial (%)", type: "number", width: "w-24" },
          { key: "taux_patronal", label: "Tx patronal (%)", type: "number", width: "w-24" },
          { key: "date_debut", label: "Début", type: "date", width: "w-28" },
          { key: "date_fin", label: "Fin", type: "date", width: "w-28" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_organisme_social", label: "Organismes sociaux",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "type", label: "Type", width: "w-24" },
          { key: "adresse", label: "Adresse" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        // RG-REGIME-REGLE-01 (Adil DAIA) : Régimes de cotisation avec lien vers la règle de calcul applicable.
        // Quand un collaborateur est affecté à ce régime (via son onglet Immatriculation),
        // la règle pointée ici est automatiquement appliquée par le moteur de paie.
        // RG-REGIME-ORG-01 : L'organisme pointe sur ref_organisme_social (lien dynamique).
        key: "ref_regime_cotisation", label: "Régimes de cotisation",
        fields: [
          { key: "code", label: "Code", width: "w-32" },
          { key: "libelle", label: "Libellé" },
          {
            key: "code_organisme", label: "Organisme", type: "select",
            refTable: "ref_organisme_social", refValueCol: "code", refLabelCol: "libelle",
            width: "w-44",
          },
          {
            key: "code_regle_cotisation", label: "Règle de cotisation", type: "select",
            refTable: "regle_calcul_cotisation", refValueCol: "code", refLabelCol: "libelle",
            width: "w-56",
          },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_mode_paiement", label: "Modes de paiement",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_statut_cnss", label: "Statuts CNSS",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre_affichage", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_imputation_comptable", label: "Imputations comptables",
        fields: [
          { key: "code_compte", label: "Code compte", width: "w-32" },
          { key: "intitule_compte", label: "Intitulé du compte" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
    ],
  },
  {
    label: "Absences & Congés",
    icon: "🏖️",
    color: "hsl(0 84% 58%)",
    tables: [
      {
        key: "ref_type_absence", label: "Types d'absence",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "impacte_paie", label: "↓ Paie", type: "boolean", width: "w-16" },
          { key: "impacte_conges", label: "↓ Congés", type: "boolean", width: "w-16" },
          { key: "justificatif_requis", label: "Justif.", type: "boolean", width: "w-16" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_motif_absence", label: "Motifs d'absence",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          {
            key: "code_type_absence", label: "Type d'absence", type: "select",
            refTable: "ref_type_absence", refValueCol: "code", refLabelCol: "libelle",
          },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      // RG-CONGE-REF-01 (Adil DAIA) : Familles de jours fériés dans les référentiels
      {
        key: "ref_famille_ferie", label: "Familles de jours fériés",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "couleur", label: "Couleur", type: "color", width: "w-28" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      // RG-CONGE-REF-02 (Adil DAIA) : Événements fériés (gabarits) dans les référentiels
      {
        key: "ref_evenement_ferie", label: "Événements fériés",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          {
            key: "code_famille", label: "Famille", type: "select",
            refTable: "ref_famille_ferie", refValueCol: "code", refLabelCol: "libelle",
          },
          { key: "nb_jours_defaut", label: "Jours défaut", type: "number", width: "w-24" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      // NOTE : Les Types de congé sont gérés dans Configuration > Gestion des Temps
    ],
  },
  {
    label: "Organisation & Statuts",
    icon: "🏢",
    color: "hsl(213 73% 30%)",
    tables: [
      {
        key: "ref_statut", label: "Statuts",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "contexte", label: "Contexte", width: "w-28" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_priorite", label: "Priorités",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "niveau", label: "Niveau", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_convention_collective", label: "Conventions collectives",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "numero_idcc", label: "N° IDCC", width: "w-24" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_secteur_activite", label: "Secteurs d'activité",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "code_naf", label: "Code NAF", width: "w-20" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_type_document", label: "Types de document",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "obligatoire", label: "Oblig.", type: "boolean", width: "w-16" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
    ],
  },
  {
    label: "Syndical & Mandats",
    icon: "✊",
    color: "hsl(340 65% 47%)",
    tables: [
      {
        key: "ref_syndicat", label: "Syndicats",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_college", label: "Collèges",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_mandat_type", label: "Types de mandat",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_grade_mandat", label: "Grades de mandat",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
    ],
  },
  {
    label: "Mouvements & Départs",
    icon: "🔄",
    color: "hsl(280 65% 50%)",
    tables: [
      {
        key: "ref_type_mouvement", label: "Types de mouvement",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "est_temporaire", label: "Temporaire", type: "boolean", width: "w-20" },
          { key: "est_definitif", label: "Définitif", type: "boolean", width: "w-20" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_motif_depart_provisoire", label: "Motifs de départ provisoire",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "description", label: "Description" },
          { key: "reconductible", label: "Recond.", type: "boolean", width: "w-20" },
          { key: "nombre_reconductions_max", label: "Nb max recond.", type: "number", width: "w-28" },
          { key: "duree_max_periode_jours", label: "Durée max/période (j)", type: "number", width: "w-36" },
          { key: "duree_globale_max_jours", label: "Durée globale max (j)", type: "number", width: "w-36" },
          { key: "reste_dans_effectif", label: "Dans effectif", type: "boolean", width: "w-24" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
    ],
  },
  {
    label: "Structure & UO",
    icon: "🏗️",
    color: "hsl(25 90% 48%)",
    tables: [
      {
        key: "ref_type_etablissement", label: "Types d'établissement",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        // RG-UO-COULEUR-01 (Adil DAIA) : La couleur du type UO s'applique aux libellés
        // dans l'organigramme et toutes les vues de structure de la société.
        key: "ref_type_uo", label: "Types d'unité organisationnelle",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "niveau", label: "Niveau hiérarchique", type: "number", width: "w-32" },
          { key: "couleur", label: "Couleur", type: "color", width: "w-28" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_type_affiliation", label: "Types d'affiliation",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "ordre", label: "Ordre", type: "number", width: "w-16" },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
    ],
  },
  {
    label: "Finance & Banques",
    icon: "🏦",
    color: "hsl(197 100% 36%)",
    tables: [
      {
        key: "ref_devise", label: "Devises",
        fields: [
          { key: "code", label: "Code", width: "w-16" },
          { key: "libelle", label: "Libellé" },
          { key: "symbole", label: "Symbole", width: "w-16" },
          {
            key: "code_pays", label: "Pays", type: "select",
            refTable: "ref_pays", refValueCol: "code", refLabelCol: "libelle",
          },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
      {
        key: "ref_banque", label: "Banques",
        fields: [
          { key: "code", label: "Code", width: "w-24" },
          { key: "libelle", label: "Libellé" },
          { key: "swift", label: "SWIFT", width: "w-24" },
          {
            key: "code_pays", label: "Pays", type: "select",
            refTable: "ref_pays", refValueCol: "code", refLabelCol: "libelle",
          },
          { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
        ],
      },
    ],
  },
];

/* ─────────────────── Default fields fallback ─────────────────── */
const DEFAULT_FIELDS: FieldDef[] = [
  { key: "code", label: "Code", width: "w-24" },
  { key: "libelle", label: "Libellé" },
  { key: "actif", label: "Actif", type: "boolean", width: "w-16" },
];

type RefRow = Record<string, any>;

/* ─────────────────── InlineSelectCreatable ─────────────────── */
interface InlineSelectCreatableProps {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  options: { value: string; label: string }[];
  refTable: string;
  refValueCol?: string;
  refLabelCol?: string;
  onCreated?: () => void;
}

const InlineSelectCreatable: React.FC<InlineSelectCreatableProps> = ({
  value, onChange, options, refTable, refValueCol = "code", refLabelCol = "libelle", onCreated,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newLibelle, setNewLibelle] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedLabel = options.find(o => o.value === value)?.label;
  const filtered = options.filter(o =>
    o.label.toLowerCase().includes(query.toLowerCase()) ||
    o.value.toLowerCase().includes(query.toLowerCase())
  );
  const exactMatch = options.some(
    o => o.label.toLowerCase() === query.toLowerCase() || o.value.toLowerCase() === query.toLowerCase()
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false); setCreating(false); setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const doCreate = async () => {
    if (!newCode.trim() || !newLibelle.trim()) { setSaveError("Code et libellé obligatoires"); return; }
    setSaving(true); setSaveError(null);
    const payload = { [refValueCol]: newCode.trim(), [refLabelCol]: newLibelle.trim(), actif: true };
    const { error } = await (supabase.from(refTable as any).insert([payload]) as any);
    setSaving(false);
    if (error) { setSaveError(error.message); return; }
    onCreated?.();
    onChange(newCode.trim());
    setOpen(false); setCreating(false); setQuery("");
  };

  const inputClass = "w-full px-2 py-1 rounded border text-xs outline-none";
  const inputStyle = { borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" };

  return (
    <div className="relative" ref={containerRef} style={{ minWidth: 120 }}>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setCreating(false); setQuery(""); }}
        className="flex h-7 w-full items-center justify-between rounded border px-2 py-1 text-xs text-left transition-colors"
        style={{ background: "hsl(var(--background))", borderColor: open ? "hsl(var(--ring))" : "hsl(var(--border))", color: value ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))" }}
      >
        <span className="truncate">{selectedLabel || "— Sélectionner —"}</span>
        <ChevronDown size={11} className="flex-shrink-0 opacity-50 ml-1" />
      </button>
      {open && (
        <div className="absolute z-[100] rounded-md border shadow-xl overflow-hidden" style={{ top: "calc(100% + 2px)", left: 0, minWidth: "100%", width: 220, background: "hsl(var(--popover))", borderColor: "hsl(var(--border))" }}>
          {!creating ? (
            <>
              <div className="p-1.5 border-b" style={{ borderColor: "hsl(var(--border))" }}>
                <div className="relative">
                  <Search size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 opacity-40" />
                  <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher…"
                    className="w-full pl-5 pr-2 py-0.5 text-xs rounded border outline-none"
                    style={{ background: "hsl(var(--muted) / 0.4)", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
                  />
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto">
                <button type="button" onClick={() => { onChange(null); setOpen(false); setQuery(""); }}
                  className="w-full flex items-center px-2 py-1 text-xs text-left transition-colors hover:bg-accent hover:text-accent-foreground"
                  style={{ color: "hsl(var(--muted-foreground))" }}>
                  — Aucun —
                </button>
                {filtered.map(o => (
                  <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); setQuery(""); }}
                    className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-left transition-colors hover:bg-accent hover:text-accent-foreground"
                    style={o.value === value ? { background: "hsl(var(--primary) / 0.08)", color: "hsl(var(--primary))" } : {}}>
                    {o.value === value && <Check size={10} className="flex-shrink-0" />}
                    <span className="truncate">{o.label}</span>
                    <span className="ml-auto font-mono text-[10px] opacity-40">{o.value}</span>
                  </button>
                ))}
                {filtered.length === 0 && <div className="px-2 py-1.5 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun résultat</div>}
              </div>
              {query && !exactMatch && (
                <div className="border-t p-1.5" style={{ borderColor: "hsl(var(--border))" }}>
                  <button type="button" onClick={() => { setNewLibelle(query); setNewCode(""); setSaveError(null); setCreating(true); }}
                    className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors"
                    style={{ background: "hsl(var(--primary) / 0.08)", color: "hsl(var(--primary))", border: "1px dashed hsl(var(--primary) / 0.4)" }}>
                    <Plus size={11} /> Créer « {query} »
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="p-2 space-y-1.5">
              <p className="text-xs font-semibold mb-1" style={{ color: "hsl(var(--foreground))" }}>Nouvelle entrée</p>
              <input value={newCode} onChange={e => setNewCode(e.target.value.toUpperCase())} placeholder="Code *" className={inputClass} style={inputStyle} />
              <input value={newLibelle} onChange={e => setNewLibelle(e.target.value)} placeholder="Libellé *" className={inputClass} style={inputStyle} />
              {saveError && <p className="text-xs text-red-500">{saveError}</p>}
              <div className="flex gap-1 pt-0.5">
                <button type="button" onClick={() => setCreating(false)} className="flex-1 py-1 rounded text-xs border" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>Annuler</button>
                <button type="button" onClick={doCreate} disabled={saving} className="flex-1 py-1 rounded text-xs font-medium" style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
                  {saving ? "…" : "Créer"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ─────────────────── DuplicateModal ─────────────────── */
// RG-REF-DUP-01 (Adil DAIA) : Duplication d'une ligne de référentiel.
// La duplication génère une nouvelle entrée en préfixant le code avec "Du_".
// L'utilisateur peut modifier le code et le libellé avant de confirmer.
interface DuplicateModalProps {
  row: RefRow;
  fields: FieldDef[];
  pkCol: string;
  activeTable: string;
  onClose: () => void;
  onSuccess: () => void;
}

const DuplicateModal: React.FC<DuplicateModalProps> = ({ row, fields, pkCol, activeTable, onClose, onSuccess }) => {
  // RG-REF-DUP-01 (Adil DAIA) : Le nouveau code est automatiquement préfixé par "Du_"
  const [newCode, setNewCode] = useState("Du_" + String(row[pkCol] || ""));
  const [newLibelle, setNewLibelle] = useState("Copie de " + String(row.libelle || row.nom || ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDuplicate = async () => {
    if (!newCode.trim()) { setError("Le code est obligatoire."); return; }
    setSaving(true); setError(null);
    // RG-REF-DUP-01 (Adil DAIA) : Copie tous les champs sauf la clé primaire, avec le nouveau code et libellé
    const payload: RefRow = { ...row };
    payload[pkCol] = newCode.trim();
    if (row.libelle !== undefined) payload.libelle = newLibelle;
    if (row.nom !== undefined) payload.nom = newLibelle;
    // Supprimer les champs auto-générés
    delete payload.id;
    delete payload.created_at;
    delete payload.updated_at;

    const { error: err } = await (supabase.from(activeTable as any).insert(payload) as any);
    setSaving(false);
    if (err) {
      setError(err.message.includes("duplicate") ? "Ce code existe déjà." : err.message);
      return;
    }
    onSuccess();
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "hsl(var(--card))", borderRadius: 12, width: "min(460px, 95vw)", border: "1px solid hsl(var(--border))", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ padding: "18px 22px 14px", borderBottom: "1px solid hsl(var(--border))", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "hsl(var(--accent) / 0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Copy size={18} style={{ color: "hsl(var(--accent))" }} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "hsl(var(--foreground))" }}>Dupliquer l'entrée</h2>
            <p style={{ margin: 0, fontSize: 11, color: "hsl(var(--muted-foreground))" }}>Le code sera préfixé par « Du_ »</p>
          </div>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "hsl(var(--muted-foreground))" }}><X size={16} /></button>
        </div>
        <div style={{ padding: "18px 22px" }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 4, color: "hsl(var(--muted-foreground))" }}>
              Nouveau code *
            </label>
            <input
              value={newCode}
              onChange={e => setNewCode(e.target.value)}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))", fontSize: 13, outline: "none", boxSizing: "border-box" }}
            />
          </div>
          {(row.libelle !== undefined || row.nom !== undefined) && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 4, color: "hsl(var(--muted-foreground))" }}>
                Libellé
              </label>
              <input
                value={newLibelle}
                onChange={e => setNewLibelle(e.target.value)}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))", fontSize: 13, outline: "none", boxSizing: "border-box" }}
              />
            </div>
          )}
          {error && <p style={{ fontSize: 12, color: "hsl(0 84% 50%)", margin: "0 0 8px" }}>{error}</p>}
        </div>
        <div style={{ padding: "12px 22px", borderTop: "1px solid hsl(var(--border))", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--muted))", color: "hsl(var(--foreground))", fontSize: 13, cursor: "pointer" }}>
            Annuler
          </button>
          <button onClick={handleDuplicate} disabled={saving} style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: "hsl(var(--accent))", color: "white", fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1, display: "flex", alignItems: "center", gap: 6 }}>
            {saving ? "…" : <><Copy size={13} /> Dupliquer</>}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ─────────────────── Import Modal ─────────────────── */
interface ImportModalProps {
  tableDef: TableDef;
  fields: FieldDef[];
  pkCol: string;
  onClose: () => void;
  onSuccess: () => void;
}

const TRUTHY = new Set(["true", "1", "oui", "yes", "o", "y", "vrai"]);

const parseValue = (val: any, field: FieldDef): any => {
  if (val === null || val === undefined || val === "") return null;
  const str = String(val).trim();
  if (field.type === "boolean") return TRUTHY.has(str.toLowerCase());
  if (field.type === "number") {
    const n = parseFloat(str.replace(",", "."));
    return isNaN(n) ? null : n;
  }
  return str === "" ? null : str;
};

const ImportModal: React.FC<ImportModalProps> = ({ tableDef, fields, pkCol, onClose, onSuccess }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"upload" | "preview" | "importing" | "done">("upload");
  const [previewRows, setPreviewRows] = useState<RefRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [importMode, setImportMode] = useState<"upsert" | "insert">("upsert");
  const [importedCount, setImportedCount] = useState(0);
  const [fileName, setFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const processFile = (file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const raw: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        if (raw.length < 2) { setErrors(["Le fichier semble vide ou ne contient qu'une ligne d'en-tête."]); return; }

        const headers: string[] = (raw[0] as string[]).map((h) => String(h).trim().toLowerCase());
        const dataRows = raw.slice(1).filter((row) => row.some((c) => c !== ""));
        const errs: string[] = [];

        const fieldMap: Record<string, FieldDef> = {};
        fields.forEach((f) => {
          const idx = headers.findIndex((h) => h === f.key.toLowerCase() || h === f.label.toLowerCase());
          if (idx !== -1) fieldMap[String(idx)] = f;
        });

        const parsed: RefRow[] = dataRows.map((row, ri) => {
          const obj: RefRow = {};
          Object.entries(fieldMap).forEach(([idxStr, field]) => {
            const raw = (row as any[])[parseInt(idxStr)];
            obj[field.key] = parseValue(raw, field);
          });
          fields.filter((f) => f.type === "boolean").forEach((f) => {
            if (obj[f.key] === null || obj[f.key] === undefined) obj[f.key] = false;
          });
          if (!obj[pkCol] && pkCol === "code") errs.push(`Ligne ${ri + 2}: colonne "${pkCol}" manquante ou vide.`);
          return obj;
        });

        setErrors(errs);
        setPreviewRows(parsed.slice(0, 50));
        setStep("preview");
      } catch (err: any) {
        setErrors([`Erreur lors de la lecture du fichier : ${err.message}`]);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleFile = (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xls", "xlsx", "csv"].includes(ext || "")) { setErrors(["Format non supporté. Utilisez .xlsx, .xls ou .csv"]); return; }
    processFile(file);
  };

  const doImport = async () => {
    setStep("importing");
    const chunkSize = 100;
    let count = 0;
    const allErrors: string[] = [];
    for (let i = 0; i < previewRows.length; i += chunkSize) {
      const chunk = previewRows.slice(i, i + chunkSize);
      if (importMode === "upsert") {
        const { error } = await (supabase.from(tableDef.key as any).upsert(chunk, { onConflict: pkCol }) as any);
        if (error) allErrors.push(`Erreur batch ${i}–${i + chunk.length}: ${error.message}`);
        else count += chunk.length;
      } else {
        const { error } = await (supabase.from(tableDef.key as any).insert(chunk) as any);
        if (error) allErrors.push(`Erreur batch ${i}–${i + chunk.length}: ${error.message}`);
        else count += chunk.length;
      }
    }
    setImportedCount(count);
    setErrors(allErrors);
    setStep("done");
  };

  const downloadTemplate = () => {
    const headers = fields.map((f) => f.key);
    const exampleRow = fields.map((f) => {
      if (f.type === "boolean") return "true";
      if (f.type === "number") return "0";
      if (f.type === "date") return "2024-01-01";
      return f.key === "code" ? "EX001" : "Exemple";
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, tableDef.label.substring(0, 31));
    XLSX.writeFile(wb, `modele_${tableDef.key}.xlsx`);
  };

  const overlayStyle: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" };
  const modalStyle: React.CSSProperties = { background: "hsl(var(--card))", borderRadius: 12, width: "min(680px, 95vw)", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", border: "1px solid hsl(var(--border))" };
  const headerStyle: React.CSSProperties = { padding: "20px 24px 16px", borderBottom: "1px solid hsl(var(--border))", display: "flex", alignItems: "center", gap: 12 };
  const bodyStyle: React.CSSProperties = { padding: "20px 24px", overflowY: "auto", flex: 1 };
  const footerStyle: React.CSSProperties = { padding: "14px 24px", borderTop: "1px solid hsl(var(--border))", display: "flex", justifyContent: "flex-end", gap: 10 };
  const btnPrimary: React.CSSProperties = { padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer", background: "hsl(var(--primary))", color: "white", fontWeight: 600, fontSize: 13 };
  const btnSecondary: React.CSSProperties = { padding: "8px 20px", borderRadius: 8, cursor: "pointer", background: "hsl(var(--muted))", color: "hsl(var(--foreground))", fontWeight: 500, fontSize: 13, border: "1px solid hsl(var(--border))" };
  const btnGreen: React.CSSProperties = { padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer", background: "hsl(84 55% 46%)", color: "white", fontWeight: 600, fontSize: 13 };

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modalStyle}>
        <div style={headerStyle}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: "hsl(var(--primary) / 0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <FileSpreadsheet size={20} style={{ color: "hsl(var(--primary))" }} />
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "hsl(var(--foreground))" }}>Import Excel / CSV</h2>
            <p style={{ margin: 0, fontSize: 12, color: "hsl(var(--muted-foreground))" }}>{tableDef.label}</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "hsl(var(--muted-foreground))" }}><X size={18} /></button>
        </div>
        <div style={bodyStyle}>
          {step === "upload" && (
            <div>
              <div
                onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onClick={() => fileRef.current?.click()}
                style={{ border: `2px dashed ${dragOver ? "hsl(var(--primary))" : "hsl(var(--border))"}`, borderRadius: 12, padding: "40px 24px", textAlign: "center", cursor: "pointer", transition: "all 0.2s", background: dragOver ? "hsl(var(--primary) / 0.05)" : "hsl(var(--muted) / 0.3)" }}
              >
                <Upload size={36} style={{ color: "hsl(var(--primary))", margin: "0 auto 12px" }} />
                <p style={{ fontWeight: 600, color: "hsl(var(--foreground))", margin: "0 0 4px" }}>Glissez-déposez votre fichier ici</p>
                <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", margin: 0 }}>ou cliquez pour sélectionner — .xlsx, .xls, .csv</p>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              </div>
              <div style={{ marginTop: 16, padding: "12px 16px", borderRadius: 8, background: "hsl(var(--accent) / 0.08)", border: "1px solid hsl(var(--accent) / 0.2)", display: "flex", alignItems: "center", gap: 10 }}>
                <Download size={16} style={{ color: "hsl(var(--accent))", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))" }}>Télécharger le modèle</p>
                  <p style={{ margin: 0, fontSize: 11, color: "hsl(var(--muted-foreground))" }}>Colonnes : {fields.map(f => f.key).join(", ")}</p>
                </div>
                <button onClick={downloadTemplate} style={{ ...btnSecondary, padding: "6px 14px", fontSize: 12 }}>Modèle .xlsx</button>
              </div>
              <div style={{ marginTop: 16 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: "hsl(var(--foreground))", margin: "0 0 8px" }}>Mode d'import</p>
                <div style={{ display: "flex", gap: 10 }}>
                  {(["upsert", "insert"] as const).map((m) => (
                    <label key={m} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, color: "hsl(var(--foreground))", padding: "8px 14px", borderRadius: 8, border: `1px solid ${importMode === m ? "hsl(var(--primary))" : "hsl(var(--border))"}`, background: importMode === m ? "hsl(var(--primary) / 0.07)" : "transparent" }}>
                      <input type="radio" value={m} checked={importMode === m} onChange={() => setImportMode(m)} style={{ accentColor: "hsl(var(--primary))" }} />
                      {m === "upsert" ? <><strong>Upsert</strong> — mettre à jour si existe, créer sinon</> : <><strong>Insertion seule</strong> — échoue si doublon</>}
                    </label>
                  ))}
                </div>
              </div>
              {errors.length > 0 && <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 8, background: "hsl(0 84% 96%)", border: "1px solid hsl(0 84% 85%)", color: "hsl(0 84% 40%)", fontSize: 12 }}>{errors.map((e, i) => <p key={i} style={{ margin: 0 }}>⚠ {e}</p>)}</div>}
            </div>
          )}
          {step === "preview" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <Check size={16} style={{ color: "hsl(84 55% 46%)" }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))" }}>{fileName} — {previewRows.length} ligne(s) détectée(s)</span>
              </div>
              {errors.length > 0 && (
                <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 8, background: "hsl(39 95% 96%)", border: "1px solid hsl(39 95% 80%)", color: "hsl(39 95% 30%)", fontSize: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, marginBottom: 4 }}><AlertTriangle size={13} /> Avertissements ({errors.length})</div>
                  {errors.slice(0, 5).map((e, i) => <p key={i} style={{ margin: 0 }}>• {e}</p>)}
                  {errors.length > 5 && <p style={{ margin: 0 }}>…et {errors.length - 5} autres</p>}
                </div>
              )}
              <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginBottom: 8 }}>Aperçu des 10 premières lignes :</p>
              <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid hsl(var(--border))" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: "hsl(var(--muted))" }}>
                      {fields.map((f) => <th key={f.key} style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap", borderBottom: "1px solid hsl(var(--border))" }}>{f.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.slice(0, 10).map((row, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid hsl(var(--border))" }}>
                        {fields.map((f) => (
                          <td key={f.key} style={{ padding: "5px 10px", color: "hsl(var(--foreground))", whiteSpace: "nowrap" }}>
                            {row[f.key] === null || row[f.key] === undefined ? <span style={{ color: "hsl(var(--muted-foreground))" }}>—</span>
                              : f.type === "boolean" ? <span style={{ color: row[f.key] ? "hsl(84 55% 46%)" : "hsl(var(--muted-foreground))" }}>{row[f.key] ? "✓" : "✗"}</span>
                              : String(row[f.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, background: "hsl(var(--muted) / 0.4)", fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
                Mode : <strong style={{ color: "hsl(var(--foreground))" }}>{importMode === "upsert" ? "Upsert (créer ou mettre à jour)" : "Insertion seule"}</strong>
                {previewRows.length > 10 && <> · <strong style={{ color: "hsl(var(--foreground))" }}>{previewRows.length - 10}</strong> lignes supplémentaires non affichées</>}
              </div>
            </div>
          )}
          {step === "importing" && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", border: "3px solid hsl(var(--primary))", borderTopColor: "transparent", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
              <p style={{ fontWeight: 600, color: "hsl(var(--foreground))", margin: 0 }}>Import en cours…</p>
            </div>
          )}
          {step === "done" && (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              {errors.length === 0 ? (
                <>
                  <div style={{ width: 56, height: 56, borderRadius: "50%", background: "hsl(84 55% 46% / 0.12)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                    <Check size={28} style={{ color: "hsl(84 55% 46%)" }} />
                  </div>
                  <p style={{ fontWeight: 700, fontSize: 16, color: "hsl(var(--foreground))", margin: "0 0 6px" }}>Import terminé !</p>
                  <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", margin: 0 }}><strong>{importedCount}</strong> enregistrement(s) importé(s) avec succès.</p>
                </>
              ) : (
                <>
                  <div style={{ width: 56, height: 56, borderRadius: "50%", background: "hsl(39 95% 96%)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                    <AlertTriangle size={28} style={{ color: "hsl(39 95% 45%)" }} />
                  </div>
                  <p style={{ fontWeight: 700, fontSize: 16, color: "hsl(var(--foreground))", margin: "0 0 6px" }}>Import partiel — {importedCount} ligne(s) importée(s)</p>
                  <div style={{ textAlign: "left", marginTop: 12, padding: "10px 14px", borderRadius: 8, background: "hsl(0 84% 96%)", border: "1px solid hsl(0 84% 85%)", fontSize: 12, color: "hsl(0 84% 40%)" }}>
                    {errors.map((e, i) => <p key={i} style={{ margin: 0 }}>• {e}</p>)}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <div style={footerStyle}>
          {step === "upload" && <button onClick={onClose} style={btnSecondary}>Annuler</button>}
          {step === "preview" && (
            <>
              <button onClick={() => { setStep("upload"); setPreviewRows([]); setErrors([]); }} style={btnSecondary}>← Retour</button>
              <button onClick={doImport} style={btnGreen} disabled={previewRows.length === 0}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Upload size={14} /> Importer {previewRows.length} ligne(s)</span>
              </button>
            </>
          )}
          {step === "done" && <button onClick={() => { onSuccess(); onClose(); }} style={btnPrimary}>Fermer et rafraîchir</button>}
        </div>
      </div>
    </div>
  );
};

/* ─────────────────── Component principal ─────────────────── */
const ReferentielsPage: React.FC = () => {
  const [activeGroup, setActiveGroup] = useState(0);
  const [activeTable, setActiveTable] = useState(REF_GROUPS[0].tables[0].key);
  const [rows, setRows] = useState<RefRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<RefRow>>({});
  const [newRow, setNewRow] = useState<Partial<RefRow> | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<number[]>([0]);
  const [error, setError] = useState("");
  const [refCache, setRefCache] = useState<Record<string, { value: string; label: string }[]>>({});
  const [showImport, setShowImport] = useState(false);
  // RG-REF-DUP-01 (Adil DAIA) : État pour la sélection de lignes et la duplication
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [duplicatingRow, setDuplicatingRow] = useState<RefRow | null>(null);

  const currentTableDef = REF_GROUPS.flatMap(g => g.tables).find(t => t.key === activeTable);
  const fields = currentTableDef?.fields || DEFAULT_FIELDS;
  const currentGroup = REF_GROUPS[activeGroup];

  const loadRefData = useCallback(async (tableDef: TableDef, forceReload = false) => {
    const selectFields = (tableDef.fields || DEFAULT_FIELDS).filter(f => f.type === "select" && f.refTable);
    const promises = selectFields
      .filter(field => field.refTable && (forceReload || !refCache[field.refTable!] || refCache[field.refTable!].length === 0))
      .map(async (field) => {
        const { data } = await (supabase.from(field.refTable as any).select("*").eq("actif", true).order("libelle") as any);
        if (data && data.length > 0) {
          setRefCache(prev => ({
            ...prev,
            [field.refTable!]: data.map((r: any) => ({
              value: r[field.refValueCol || "code"],
              label: r[field.refLabelCol || "libelle"],
            })),
          }));
        }
      });
    await Promise.all(promises);
  }, [refCache]);

  const loadRows = async (table: string) => {
    setLoading(true); setError(""); setSelectedRows(new Set());
    try {
      const { data, error: err } = await (supabase.from(table as any).select("*").order("ordre", { ascending: true, nullsFirst: false }) as any);
      if (err) throw err;
      setRows(data || []);
    } catch {
      try {
        const { data } = await (supabase.from(table as any).select("*") as any);
        setRows(data || []);
      } catch {
        setRows([]);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    loadRows(activeTable);
    const tableDef = REF_GROUPS.flatMap(g => g.tables).find(t => t.key === activeTable);
    if (tableDef) loadRefData(tableDef, true);
  }, [activeTable]);

  const filtered = rows.filter(r =>
    (r.libelle?.toLowerCase() || r.nom?.toLowerCase() || "").includes(search.toLowerCase()) ||
    (r.code && r.code.toLowerCase().includes(search.toLowerCase()))
  );

  const pkCol = fields.some(f => f.key === "code") ? "code" : "id";
  const pkField = (r: RefRow) => r[pkCol];

  const saveEdit = async (pk: string) => {
    const { error: err } = await (supabase.from(activeTable as any).update(editValues).eq(pkCol, pk) as any);
    if (!err) { setEditingRow(null); loadRows(activeTable); }
    else setError(err.message);
  };

  const deleteRow = async (pk: string) => {
    // Point 5 : Archiver (soft delete) au lieu de supprimer physiquement
    // On désactive l'entrée (actif = false) pour garder l'historique
    const hasActifField = fields.some(f => f.key === "actif");
    if (hasActifField) {
      if (!confirm("Archiver cette entrée ? Elle sera désactivée mais restera consultable.")) return;
      const { error: err } = await (supabase.from(activeTable as any).update({ actif: false }).eq(pkCol, pk) as any);
      if (err) setError(err.message);
      else loadRows(activeTable);
    } else {
      if (!confirm("Supprimer cette entrée ?")) return;
      await (supabase.from(activeTable as any).delete().eq(pkCol, pk) as any);
      loadRows(activeTable);
    }
  };

  const saveNew = async () => {
    const { error: err } = await (supabase.from(activeTable as any).insert(newRow) as any);
    if (!err) { setNewRow(null); loadRows(activeTable); }
    else setError(err.message);
  };

  const toggleGroup = (i: number) => setExpandedGroups(prev =>
    prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]
  );

  // RG-REF-DUP-01 (Adil DAIA) : Bascule la sélection d'une ligne pour la duplication
  const toggleRowSelection = (pk: string) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(pk)) next.delete(pk);
      else next.add(pk);
      return next;
    });
  };

  const renderCell = (row: RefRow, field: FieldDef) => {
    const val = row[field.key];
    if (field.type === "boolean") {
      return (
        <span className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full ${val ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"}`}>
          {val ? <Check size={9} /> : <X size={9} />}
          {val ? "Oui" : "Non"}
        </span>
      );
    }
    if (field.type === "color") {
      return val ? (
        <span className="inline-flex items-center gap-2">
          <span style={{ width: 18, height: 18, borderRadius: 4, background: val, border: "1px solid hsl(var(--border))", flexShrink: 0, display: "inline-block" }} />
          <span className="text-xs font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>{val}</span>
        </span>
      ) : "—";
    }
    if (field.type === "select" && field.refTable) {
      const opts = refCache[field.refTable] || [];
      const match = opts.find(o => o.value === val);
      return match ? (
        <span className="inline-flex items-center gap-1 text-xs">
          <ExternalLink size={10} style={{ color: "hsl(var(--accent))", opacity: 0.6 }} />
          {match.label}
        </span>
      ) : (val ? <span className="text-xs font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>{val}</span> : "—");
    }
    if (field.key === "code") {
      return <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>{val}</span>;
    }
    return val !== null && val !== undefined && val !== "" ? String(val) : "—";
  };

  const renderEditCell = (field: FieldDef, currentVal: any, onChange: (v: any) => void) => {
    const inputClass = "w-full px-2 py-1 rounded border text-xs";
    const inputStyle = { borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" };
    if (field.type === "boolean") return <input type="checkbox" checked={!!currentVal} onChange={e => onChange(e.target.checked)} className="w-4 h-4 cursor-pointer" />;
    if (field.type === "number") return <input type="number" value={currentVal ?? ""} onChange={e => onChange(e.target.value === "" ? null : +e.target.value)} className={inputClass} style={inputStyle} />;
    if (field.type === "date") return <input type="date" value={currentVal || ""} onChange={e => onChange(e.target.value || null)} className={inputClass} style={inputStyle} />;
    if (field.type === "color") return <ColorPicker value={currentVal || ""} onChange={onChange} />;
    if (field.type === "select" && field.refTable) {
      const opts = refCache[field.refTable] || [];
      const refT = field.refTable;
      return (
        <InlineSelectCreatable
          value={currentVal}
          onChange={onChange}
          options={opts}
          refTable={refT}
          refValueCol={field.refValueCol || "code"}
          refLabelCol={field.refLabelCol || "libelle"}
          onCreated={() => {
            setRefCache(prev => { const n = { ...prev }; delete n[refT]; return n; });
          }}
        />
      );
    }
    return <input type="text" value={currentVal || ""} onChange={e => onChange(e.target.value)} className={inputClass} style={inputStyle} />;
  };

  const totalTables = REF_GROUPS.reduce((acc, g) => acc + g.tables.length, 0);

  return (
    <>
      {/* RG-REF-DUP-01 (Adil DAIA) : Modal de confirmation de duplication avec préfixe "Du_" */}
      {duplicatingRow && (
        <DuplicateModal
          row={duplicatingRow}
          fields={fields}
          pkCol={pkCol}
          activeTable={activeTable}
          onClose={() => setDuplicatingRow(null)}
          onSuccess={() => loadRows(activeTable)}
        />
      )}

      {showImport && currentTableDef && (
        <ImportModal
          tableDef={currentTableDef}
          fields={fields}
          pkCol={pkCol}
          onClose={() => setShowImport(false)}
          onSuccess={() => loadRows(activeTable)}
        />
      )}

      <div className="flex h-full" style={{ height: "calc(100vh - 0px)" }}>
        {/* ── Left sidebar ── */}
        <aside className="flex-shrink-0 overflow-y-auto py-3 px-2 border-r" style={{ width: 220, borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
          <div className="px-2 mb-3">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>
              Référentiels
            </p>
            <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))", opacity: 0.7 }}>
              {totalTables} tables · {REF_GROUPS.length} groupes
            </p>
          </div>
          {REF_GROUPS.map((group, gi) => (
            <div key={gi} className="mb-0.5">
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background: activeGroup === gi ? `${group.color}18` : "transparent",
                  color: activeGroup === gi ? group.color : "hsl(var(--foreground))",
                }}
                onClick={() => { setActiveGroup(gi); toggleGroup(gi); }}
              >
                <span className="text-sm">{group.icon}</span>
                <span className="flex-1 text-left truncate">{group.label}</span>
                <span className="text-xs opacity-50">{group.tables.length}</span>
                {expandedGroups.includes(gi) ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
              {expandedGroups.includes(gi) && (
                <div className="pl-5 mt-0.5 space-y-0.5 mb-1">
                  {group.tables.map(t => (
                    <button
                      key={t.key}
                      className="w-full text-left px-2 py-1 rounded text-xs transition-all"
                      style={{
                        background: activeTable === t.key ? `${group.color}22` : "transparent",
                        color: activeTable === t.key ? group.color : "hsl(var(--muted-foreground))",
                        fontWeight: activeTable === t.key ? 600 : 400,
                        borderLeft: activeTable === t.key ? `2px solid ${group.color}` : "2px solid transparent",
                      }}
                      onClick={() => { setActiveTable(t.key); setActiveGroup(gi); setSearch(""); setNewRow(null); setEditingRow(null); }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </aside>

        {/* ── Main content ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-6 py-3 border-b flex items-center gap-3 flex-wrap" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
            <div className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0"
                style={{ background: `${currentGroup?.color}18` }}
              >
                {currentGroup?.icon}
              </div>
              <div>
                <h1 className="text-base font-bold leading-tight">{currentTableDef?.label || "Référentiel"}</h1>
                <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {rows.length} entrée(s) · {currentGroup?.label}
                  {selectedRows.size > 0 && (
                    <span className="ml-2 font-semibold" style={{ color: "hsl(var(--accent))" }}>
                      · {selectedRows.size} sélectionnée(s)
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex-1" />
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher…"
                className="pl-8 pr-3 py-1.5 rounded-lg text-xs border outline-none w-44"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
              />
            </div>
            <button
              onClick={() => {
                const exportData = rows.map(r => {
                  const obj: Record<string, unknown> = {};
                  fields.forEach(f => { obj[f.label] = r[f.key] ?? ""; });
                  return obj;
                });
                const ws = XLSX.utils.json_to_sheet(exportData);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, activeTable);
                XLSX.writeFile(wb, `${activeTable}_export.xlsx`);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:opacity-90"
              style={{ background: "hsl(84 55% 46% / 0.12)", color: "hsl(84 55% 36%)", border: "1px solid hsl(84 55% 46% / 0.3)" }}
            >
              <Download size={13} /> Exporter
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:opacity-90"
              style={{ background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))", border: "1px solid hsl(var(--accent) / 0.3)" }}
            >
              <Upload size={13} /> Importer
            </button>
            <button
              onClick={() => {
                const emptyRow: Partial<RefRow> = { actif: true };
                fields.forEach(f => { if (f.type === "boolean") emptyRow[f.key] = false; });
                setNewRow(emptyRow);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:opacity-90"
              style={{ background: "hsl(var(--primary))", color: "white" }}
            >
              <Plus size={13} /> Ajouter
            </button>
          </div>

          {error && (
            <div className="mx-6 mt-3 px-4 py-2 rounded-lg text-xs" style={{ background: "hsl(0 84% 96%)", color: "hsl(0 84% 40%)", border: "1px solid hsl(0 84% 85%)" }}>
              {error} <button onClick={() => setError("")} className="ml-2 font-bold">×</button>
            </div>
          )}

          {/* Table */}
          <div className="flex-1 overflow-auto px-6 py-4">
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "hsl(var(--accent))", borderTopColor: "transparent" }} />
              </div>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr style={{ borderBottom: "2px solid hsl(var(--border))" }}>
                    {/* RG-REF-DUP-01 (Adil DAIA) : Colonne case à cocher pour la sélection/duplication */}
                    <th className="w-8 py-2 px-2" />
                    {fields.map(f => (
                      <th key={f.key} className={`text-left py-2 px-3 text-xs font-semibold uppercase tracking-wider ${f.width || ""}`} style={{ color: "hsl(var(--muted-foreground))" }}>
                        {f.type === "select" ? (
                          <span className="flex items-center gap-1">
                            <ExternalLink size={10} style={{ color: "hsl(var(--accent))" }} />
                            {f.label}
                          </span>
                        ) : f.label}
                      </th>
                    ))}
                    <th className="w-20" />
                  </tr>
                </thead>
                <tbody>
                  {newRow !== null && (
                    <tr className="border-b" style={{ borderColor: "hsl(var(--border))", background: "hsl(84 55% 50% / 0.05)" }}>
                      <td className="py-1.5 px-2" />
                      {fields.map(f => (
                        <td key={f.key} className="py-1.5 px-3">
                          {renderEditCell(f, newRow[f.key], v => setNewRow({ ...newRow, [f.key]: v }))}
                        </td>
                      ))}
                      <td className="py-1.5 px-3">
                        <div className="flex gap-1">
                          <button onClick={saveNew} className="p-1.5 rounded-lg" style={{ background: "hsl(84 55% 50%)", color: "white" }}><Check size={12} /></button>
                          <button onClick={() => setNewRow(null)} className="p-1.5 rounded-lg" style={{ background: "hsl(var(--muted))", color: "hsl(var(--foreground))" }}><X size={12} /></button>
                        </div>
                      </td>
                    </tr>
                  )}

                  {filtered.length === 0 && !newRow ? (
                    <tr>
                      <td colSpan={fields.length + 2} className="text-center py-12 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                        Aucune entrée. Cliquez sur "Ajouter" ou "Importer" pour commencer.
                      </td>
                    </tr>
                  ) : filtered.map(row => {
                    const pk = pkField(row) as string;
                    const isEditing = editingRow === pk;
                    const isSelected = selectedRows.has(pk);
                    return (
                      <tr key={pk} className="border-b transition-all hover:bg-muted/20"
                        style={{
                          borderColor: "hsl(var(--border))",
                          background: isSelected ? "hsl(var(--accent) / 0.06)" : undefined,
                        }}>
                        {/* RG-REF-DUP-01 (Adil DAIA) : Case à cocher de sélection pour déclencher la duplication */}
                        <td className="py-1.5 px-2">
                          <div className="flex items-center justify-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleRowSelection(pk)}
                              className="w-3.5 h-3.5 cursor-pointer rounded"
                              style={{ accentColor: "hsl(var(--accent))" }}
                              title="Sélectionner pour dupliquer"
                            />
                          </div>
                        </td>
                        {fields.map(f => (
                          <td key={f.key} className="py-1.5 px-3 text-sm">
                            {isEditing
                              ? renderEditCell(f, editValues[f.key] !== undefined ? editValues[f.key] : row[f.key], v => setEditValues({ ...editValues, [f.key]: v }))
                              : renderCell(row, f)
                            }
                          </td>
                        ))}
                        <td className="py-1.5 px-3">
                          <div className="flex gap-1">
                            {isEditing ? (
                              <>
                                <button onClick={() => saveEdit(pk)} className="p-1.5 rounded-lg" style={{ background: "hsl(84 55% 50%)", color: "white" }}><Check size={12} /></button>
                                <button onClick={() => setEditingRow(null)} className="p-1.5 rounded-lg" style={{ background: "hsl(var(--muted))", color: "hsl(var(--foreground))" }}><X size={12} /></button>
                              </>
                            ) : (
                              <>
                                {/* RG-REF-DUP-01 (Adil DAIA) : Bouton dupliquer visible uniquement si la ligne est sélectionnée */}
                                {isSelected && (
                                  <button
                                    onClick={() => setDuplicatingRow(row)}
                                    className="p-1.5 rounded transition-all"
                                    style={{ color: "hsl(var(--accent))", background: "hsl(var(--accent) / 0.1)" }}
                                    title="Dupliquer cette entrée (code préfixé Du_)"
                                  >
                                    <Copy size={13} />
                                  </button>
                                )}
                                <button onClick={() => { setEditingRow(pk); setEditValues({ ...row }); }} className="p-1.5 rounded hover:bg-blue-50 transition-all" style={{ color: "hsl(197 100% 38%)" }}><Pencil size={13} /></button>
                                <button onClick={() => deleteRow(pk)} className="p-1.5 rounded hover:bg-red-50 transition-all" style={{ color: "hsl(0 84% 58%)" }}><Trash2 size={13} /></button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default ReferentielsPage;
