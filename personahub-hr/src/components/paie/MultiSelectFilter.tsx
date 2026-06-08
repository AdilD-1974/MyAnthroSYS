/**
 * MultiSelectFilter — Filtre déroulant à choix multiples avec recherche.
 * Auteur : Adil DAIA — RG-FILTER-MULTI-01 (07/05/2026)
 *
 * Affiche un trigger button qui ouvre un Popover contenant :
 *   - Un input de recherche pour filtrer les options
 *   - Une liste de cases à cocher
 *   - Un bouton "Tout cocher / Tout décocher"
 *   - Un compteur "X sélectionnés"
 *
 * Usage :
 *   const [selected, setSelected] = useState<string[]>([]);
 *   <MultiSelectFilter
 *     label="Familles"
 *     options={familles.map(f => ({ value: f.code, label: f.libelle }))}
 *     selected={selected}
 *     onChange={setSelected}
 *   />
 *
 * Côté filtre :
 *   if (selected.length > 0) list = list.filter(r => selected.includes(r.code_famille));
 */
import React, { useState, useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ChevronDown, Search, X, Check } from "lucide-react";

interface Option {
  value: string;
  label: string;
}

interface Props {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (values: string[]) => void;
  /** Largeur du trigger (Tailwind class). Défaut "min-w-[180px]" */
  className?: string;
  /** Si true, affiche les libellés sélectionnés au lieu de "X sélectionnés" (limit ~3) */
  showSelectedLabels?: boolean;
}

const MultiSelectFilter: React.FC<Props> = ({
  label, options, selected, onChange, className, showSelectedLabels,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options;
    const s = search.toLowerCase();
    return options.filter(o =>
      o.label.toLowerCase().includes(s) || o.value.toLowerCase().includes(s)
    );
  }, [options, search]);

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter(v => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const allFilteredSelected = filteredOptions.length > 0
    && filteredOptions.every(o => selected.includes(o.value));

  const toggleAll = () => {
    if (allFilteredSelected) {
      // Tout décocher (sur les filtrés uniquement)
      onChange(selected.filter(v => !filteredOptions.some(o => o.value === v)));
    } else {
      // Tout cocher
      const merged = Array.from(new Set([...selected, ...filteredOptions.map(o => o.value)]));
      onChange(merged);
    }
  };

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  // Affichage du trigger
  const renderTriggerLabel = () => {
    if (selected.length === 0) return `Tous · ${label}`;
    if (showSelectedLabels && selected.length <= 3) {
      const labels = selected.map(v => options.find(o => o.value === v)?.label || v);
      return labels.join(", ");
    }
    return `${selected.length} sélectionné${selected.length > 1 ? "s" : ""}`;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={`justify-between gap-2 font-normal ${className || "min-w-[180px]"}`}>
          <span className="truncate text-sm">{renderTriggerLabel()}</span>
          <span className="flex items-center gap-1 flex-shrink-0">
            {selected.length > 0 && (
              <span
                onClick={clearAll}
                className="p-0.5 rounded hover:bg-muted text-muted-foreground"
                title="Effacer la sélection"
                role="button"
                tabIndex={0}>
                <X size={13} />
              </span>
            )}
            <ChevronDown size={14} className="opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <div className="px-3 py-2 border-b border-border">
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Rechercher ${label.toLowerCase()}…`}
              className="w-full pl-7 pr-2 py-1 rounded text-xs outline-none bg-background border border-border"
            />
          </div>
        </div>
        <div className="max-h-[280px] overflow-y-auto">
          {filteredOptions.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              Aucun résultat
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={toggleAll}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-muted border-b border-border text-accent">
                {allFilteredSelected ? "Tout décocher" : "Tout cocher"}
                {search && filteredOptions.length < options.length && (
                  <span className="text-muted-foreground">({filteredOptions.length})</span>
                )}
              </button>
              {filteredOptions.map(opt => {
                const isSelected = selected.includes(opt.value);
                return (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() => toggle(opt.value)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted text-left transition-colors ${
                      isSelected ? "bg-accent/5" : ""
                    }`}>
                    <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                      isSelected ? "bg-accent border-accent" : "border-border"
                    }`}>
                      {isSelected && <Check size={10} className="text-white" />}
                    </span>
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
        {selected.length > 0 && (
          <div className="px-3 py-2 border-t border-border flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{selected.length} sélectionné(s)</span>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-accent hover:underline">
              Effacer tout
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default MultiSelectFilter;
