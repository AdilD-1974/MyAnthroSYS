/**
 * RefSelect – liste déroulante chargée depuis une table de référence Supabase.
 * Filtré automatiquement sur actif = true.
 * Inclut une barre de recherche intégrée.
 */
import React, { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ChevronDown, Search, X } from "lucide-react";

interface RefSelectProps {
  /** Nom de la table Supabase (ex: "ref_pays") */
  table: string;
  /** Colonne utilisée comme valeur (défaut: "code") */
  valueCol?: string;
  /** Colonne utilisée comme libellé (défaut: "libelle") */
  labelCol?: string;
  /** Valeur sélectionnée */
  value: string;
  /** Callback lors du changement */
  onChange: (value: string) => void;
  /** Label affiché au-dessus */
  label?: string;
  /** Champ obligatoire */
  required?: boolean;
  /** Classe CSS supplémentaire pour le conteneur */
  className?: string;
  /** Placeholder du trigger */
  placeholder?: string;
  /** Désactivé */
  disabled?: boolean;
  /** Options statiques optionnelles (remplace le chargement Supabase) */
  staticOptions?: { value: string; label: string }[];
  /** Filtre supplémentaire (ex: { actif: true }) */
  extraFilter?: Record<string, unknown>;
}

const RefSelect: React.FC<RefSelectProps> = ({
  table,
  valueCol = "code",
  labelCol = "libelle",
  value,
  onChange,
  label,
  required,
  className,
  placeholder = "— Sélectionner —",
  disabled = false,
  staticOptions,
  extraFilter,
}) => {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Charger depuis Supabase si pas d'options statiques
  useEffect(() => {
    if (staticOptions) {
      setOptions(staticOptions);
      return;
    }
    const fetchData = async () => {
      const { data } = await supabase
        .from(table as never)
        .select(`${valueCol}, ${labelCol}, actif`)
        .eq("actif" as never, true as never)
        .order(labelCol as never);

      if (data) {
        setOptions(
          (data as any[]).map((row: any) => ({
            value: String(row[valueCol] ?? ""),
            label: String(row[labelCol] ?? ""),
          }))
        );
      }
    };
    fetchData();
  }, [table, valueCol, labelCol, staticOptions]);

  // Fermer au clic extérieur
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = options.filter(o =>
    o.label.toLowerCase().includes(search.toLowerCase()) ||
    o.value.toLowerCase().includes(search.toLowerCase())
  );

  const selected = options.find(o => o.value === value);
  const displayLabel = selected ? `${selected.label}` : "";

  return (
    <div className={className} ref={containerRef} style={{ position: "relative" }}>
      {label && (
        <label
          className="block text-xs font-medium mb-1"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {label}
          {required && <span style={{ color: "hsl(0 84% 55%)" }}> *</span>}
        </label>
      )}

      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) { setOpen(o => !o); setSearch(""); } }}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm outline-none transition-all text-left"
        style={{
          borderColor: open ? "hsl(var(--accent))" : "hsl(var(--border))",
          background: disabled ? "hsl(var(--muted) / 0.5)" : "hsl(var(--background))",
          color: displayLabel ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
          minHeight: 40,
          cursor: disabled ? "not-allowed" : "pointer",
          boxShadow: open ? "0 0 0 2px hsl(var(--accent) / 0.2)" : "none",
        }}
      >
        <span className="truncate">{displayLabel || placeholder}</span>
        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
          {value && (
            <span
              onClick={e => { e.stopPropagation(); onChange(""); }}
              className="p-0.5 rounded hover:bg-muted"
              style={{ color: "hsl(var(--muted-foreground))", cursor: "pointer" }}
            >
              <X size={12} />
            </span>
          )}
          <ChevronDown
            size={14}
            style={{
              color: "hsl(var(--muted-foreground))",
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.15s",
            }}
          />
        </div>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute z-50 w-full rounded-lg border shadow-lg mt-1"
          style={{
            background: "hsl(var(--popover))",
            borderColor: "hsl(var(--border))",
            boxShadow: "0 8px 24px hsl(0 0% 0% / 0.12)",
            maxHeight: 280,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Search */}
          <div
            className="flex items-center gap-2 px-3 py-2 border-b"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <Search size={13} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
            <input
              autoFocus
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher..."
              className="flex-1 text-sm outline-none bg-transparent"
              style={{ color: "hsl(var(--foreground))" }}
            />
          </div>

          {/* Options list */}
          <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
            {/* Option vide */}
            <button
              type="button"
              onClick={() => { onChange(""); setOpen(false); setSearch(""); }}
              className="w-full text-left px-3 py-2 text-sm transition-colors"
              style={{
                color: "hsl(var(--muted-foreground))",
                background: !value ? "hsl(var(--accent) / 0.08)" : "transparent",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "hsl(var(--accent) / 0.08)")}
              onMouseLeave={e => (e.currentTarget.style.background = !value ? "hsl(var(--accent) / 0.08)" : "transparent")}
            >
              — Sélectionner —
            </button>

            {filtered.length === 0 ? (
              <p className="text-xs text-center py-4" style={{ color: "hsl(var(--muted-foreground))" }}>
                Aucun résultat
              </p>
            ) : (
              filtered.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onChange(opt.value); setOpen(false); setSearch(""); }}
                  className="w-full text-left px-3 py-2 text-sm transition-colors"
                  style={{
                    background: opt.value === value ? "hsl(var(--accent) / 0.12)" : "transparent",
                    color: opt.value === value ? "hsl(var(--accent))" : "hsl(var(--foreground))",
                    fontWeight: opt.value === value ? 600 : 400,
                  }}
                  onMouseEnter={e => { if (opt.value !== value) e.currentTarget.style.background = "hsl(var(--accent) / 0.06)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = opt.value === value ? "hsl(var(--accent) / 0.12)" : "transparent"; }}
                >
                  <span style={{ color: "hsl(var(--muted-foreground))", fontSize: "0.7rem", marginRight: 6 }}>{opt.value}</span>
                  {opt.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default RefSelect;
