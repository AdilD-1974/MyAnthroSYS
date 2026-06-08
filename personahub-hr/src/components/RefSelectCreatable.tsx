/**
 * RefSelectCreatable – liste déroulante chargée depuis une table de référence Supabase.
 * Avec possibilité de créer une nouvelle entrée directement depuis le dropdown.
 */
import React, { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ChevronDown, Search, X, Plus, Loader2, Check } from "lucide-react";

interface RefSelectCreatableProps {
  table: string;
  valueCol?: string;
  labelCol?: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  required?: boolean;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  staticOptions?: { value: string; label: string }[];
}

const RefSelectCreatable: React.FC<RefSelectCreatableProps> = ({
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
}) => {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchData = async () => {
    if (staticOptions) { setOptions(staticOptions); return; }
    if (!table) return;

    // Construction dynamique du SELECT pour ne charger que les colonnes nécessaires.
    // On ajoute "actif" si dispo (ignoré silencieusement si la table n'a pas cette colonne).
    const selectCols = `${valueCol}, ${labelCol}`;

    try {
      // Tenter d'abord avec filtre actif=true (référentiels classiques)
      let res = await supabase
        .from(table as never)
        .select(selectCols as never)
        .eq("actif" as never, true as never);

      // Si la colonne "actif" n'existe pas → on retente sans filtre
      if (res.error && /actif/i.test(String(res.error.message || ""))) {
        res = await supabase.from(table as never).select(selectCols as never);
      }

      const rows = (res.data as any[]) || [];
      setOptions(
        rows.map((row: any) => ({
          value: String(row[valueCol] ?? ""),
          label: String(row[labelCol] ?? ""),
        }))
      );
    } catch (e) {
      console.error(`RefSelectCreatable: échec chargement ${table}`, e);
      setOptions([]);
    }
  };

  useEffect(() => { fetchData(); }, [table, valueCol, labelCol, staticOptions]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
        setCreating(false);
        setSaveError(null);
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

  const handleCreate = async () => {
    if (!newCode.trim() || !newLabel.trim()) {
      setSaveError("Code et libellé sont obligatoires.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    const { error } = await supabase.from(table as never).insert({
      [valueCol]: newCode.trim().toUpperCase(),
      [labelCol]: newLabel.trim(),
      actif: true,
    } as never);
    setSaving(false);
    if (error) {
      setSaveError(error.message.includes("duplicate") ? "Ce code existe déjà." : error.message);
      return;
    }
    await fetchData();
    onChange(newCode.trim().toUpperCase());
    setCreating(false);
    setNewCode("");
    setNewLabel("");
    setOpen(false);
    setSearch("");
  };

  return (
    <div className={className} ref={containerRef} style={{ position: "relative" }}>
      {label && (
        <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
          {label}{required && <span style={{ color: "hsl(0 84% 55%)" }}> *</span>}
        </label>
      )}

      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) { setOpen(o => !o); setSearch(""); setCreating(false); } }}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm outline-none transition-all text-left"
        style={{
          borderColor: open ? "hsl(var(--accent))" : "hsl(var(--border))",
          background: disabled ? "hsl(var(--muted) / 0.5)" : "hsl(var(--background))",
          color: selected ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
          minHeight: 40,
          cursor: disabled ? "not-allowed" : "pointer",
          boxShadow: open ? "0 0 0 2px hsl(var(--accent) / 0.2)" : "none",
        }}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
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
          <ChevronDown size={14} style={{
            color: "hsl(var(--muted-foreground))",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
          }} />
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
            maxHeight: 340,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Search */}
          {!creating && (
            <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: "hsl(var(--border))" }}>
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
          )}

          {/* Create form */}
          {creating ? (
            <div className="p-3 flex flex-col gap-2">
              <p className="text-xs font-semibold mb-1" style={{ color: "hsl(var(--accent))" }}>
                Nouveau référentiel
              </p>
              <div className="flex gap-2">
                <div className="w-24">
                  <p className="text-xs mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Code *</p>
                  <input
                    autoFocus
                    type="text"
                    value={newCode}
                    onChange={e => setNewCode(e.target.value)}
                    placeholder="CODE"
                    className="w-full px-2 py-1.5 rounded border text-xs outline-none"
                    style={{
                      borderColor: "hsl(var(--border))",
                      background: "hsl(var(--background))",
                      color: "hsl(var(--foreground))",
                    }}
                    onKeyDown={e => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setCreating(false); setSaveError(null); } }}
                  />
                </div>
                <div className="flex-1">
                  <p className="text-xs mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Libellé *</p>
                  <input
                    type="text"
                    value={newLabel}
                    onChange={e => setNewLabel(e.target.value)}
                    placeholder="Libellé..."
                    className="w-full px-2 py-1.5 rounded border text-xs outline-none"
                    style={{
                      borderColor: "hsl(var(--border))",
                      background: "hsl(var(--background))",
                      color: "hsl(var(--foreground))",
                    }}
                    onKeyDown={e => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setCreating(false); setSaveError(null); } }}
                  />
                </div>
              </div>
              {saveError && (
                <p className="text-xs" style={{ color: "hsl(0 84% 50%)" }}>{saveError}</p>
              )}
              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors"
                  style={{ background: "hsl(var(--accent))", color: "white" }}
                >
                  {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                  {saving ? "Création…" : "Créer"}
                </button>
                <button
                  type="button"
                  onClick={() => { setCreating(false); setSaveError(null); setNewCode(""); setNewLabel(""); }}
                  className="px-3 py-1.5 rounded text-xs border transition-colors"
                  style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Options list */}
              <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
                <button
                  type="button"
                  onClick={() => { onChange(""); setOpen(false); setSearch(""); }}
                  className="w-full text-left px-3 py-2 text-sm transition-colors"
                  style={{ color: "hsl(var(--muted-foreground))", background: !value ? "hsl(var(--accent) / 0.08)" : "transparent" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "hsl(var(--accent) / 0.08)")}
                  onMouseLeave={e => (e.currentTarget.style.background = !value ? "hsl(var(--accent) / 0.08)" : "transparent")}
                >
                  — Sélectionner —
                </button>
                {filtered.length === 0 ? (
                  <p className="text-xs text-center py-3" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun résultat</p>
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

              {/* Add new button */}
              {table && (
                <div className="border-t px-3 py-2" style={{ borderColor: "hsl(var(--border))" }}>
                  <button
                    type="button"
                    onClick={() => { setCreating(true); setSearch(""); }}
                    className="flex items-center gap-2 text-xs font-medium w-full py-1 transition-colors"
                    style={{ color: "hsl(var(--accent))" }}
                  >
                    <Plus size={12} />
                    Créer un nouveau référentiel
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default RefSelectCreatable;
