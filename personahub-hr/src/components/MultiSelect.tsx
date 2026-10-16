/**
 * MultiSelect.tsx — sélection multiple par cases à cocher (sans dépendance).
 * Auteur : Adil DAIA
 *
 *   <MultiSelect options={[{value,label}]} selected={ids} onChange={setIds} placeholder="Type" />
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Check } from "lucide-react";

interface Opt { value: string; label: string; color?: string; }
interface Props {
  options: Opt[];
  selected: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  searchable?: boolean;
  className?: string;
}

export default function MultiSelect({
  options, selected, onChange, placeholder = "Sélectionner…", searchable = true, className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? options.filter(o => o.label.toLowerCase().includes(t)) : options;
  }, [options, q]);

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);

  const label = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? (options.find(o => o.value === selected[0])?.label || "1 sélectionné")
      : `${selected.length} sélectionnés`;

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex h-10 w-full items-center justify-between rounded-md border px-3 text-sm"
        style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))" }}>
        <span style={{ color: selected.length ? "inherit" : "hsl(var(--muted-foreground))" }} className="truncate">{label}</span>
        <ChevronDown size={16} className="opacity-60 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[200px] rounded-md border shadow-lg"
          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
          {searchable && (
            <div className="flex items-center gap-2 border-b px-2 py-1.5" style={{ borderColor: "hsl(var(--border))" }}>
              <Search size={14} className="opacity-60" />
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Filtrer…"
                className="w-full bg-transparent text-sm outline-none" />
            </div>
          )}
          {selected.length > 0 && (
            <button type="button" onClick={() => onChange([])}
              className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-[hsl(var(--muted))]"
              style={{ color: "hsl(var(--muted-foreground))" }}>
              Tout désélectionner
            </button>
          )}
          <div className="max-h-60 overflow-auto py-1">
            {list.length === 0 ? (
              <p className="px-3 py-2 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun élément.</p>
            ) : list.map(o => (
              <button key={o.value} type="button" onClick={() => toggle(o.value)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-[hsl(var(--muted))]">
                <span className="flex h-4 w-4 items-center justify-center rounded border flex-shrink-0"
                  style={{
                    borderColor: selected.includes(o.value) ? "hsl(var(--primary))" : "hsl(var(--border))",
                    background: selected.includes(o.value) ? "hsl(var(--primary))" : "transparent",
                  }}>
                  {selected.includes(o.value) && <Check size={12} className="text-white" />}
                </span>
                {o.color && <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: o.color }} />}
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
