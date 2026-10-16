/**
 * UoTreePicker.tsx — filtre d'unités organisationnelles, ARBORESCENT
 * Auteur : Adil DAIA
 *
 * UO du périmètre (scopées serveur selon le rôle actif), affichées en arbre
 * (indentation parent → enfant). Multi-sélection, « Tout sélectionner / Effacer »,
 * bouton « Appliquer ». Cocher une UO inclut ses sous-UO (côté serveur).
 *
 *   <UoTreePicker selected={uoIds} onChange={setUoIds} />
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { ChevronDown, ChevronRight, Check, Search, Building2 } from "lucide-react";

interface Uo { id: string; parent_id: string | null; libelle: string; code?: string; niveau?: number; }
interface Props { selected: string[]; onChange: (v: string[]) => void; }

export default function UoTreePicker({ selected, onChange }: Props) {
  const { role } = useAuth() as any;
  const [uos, setUos] = useState<Uo[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<string[]>(selected);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get(`/conges/uos${role ? `?role_actif=${encodeURIComponent(role)}` : ""}`)
      .then(r => setUos(r || [])).catch(() => {});
    // eslint-disable-next-line
  }, [role]);

  useEffect(() => { if (open) setDraft(selected); /* eslint-disable-next-line */ }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  // Index des enfants. Les UO dont le parent n'est pas dans le périmètre sont
  // traitées comme racines (sinon elles disparaîtraient de l'arbre).
  const { enfants, racines } = useMemo(() => {
    const ids = new Set(uos.map(u => u.id));
    const e: Record<string, Uo[]> = {};
    const r: Uo[] = [];
    uos.forEach(u => {
      if (u.parent_id && ids.has(u.parent_id)) (e[u.parent_id] = e[u.parent_id] || []).push(u);
      else r.push(u);
    });
    return { enfants: e, racines: r };
  }, [uos]);

  const toggle = (id: string) => setDraft(d => d.includes(id) ? d.filter(x => x !== id) : [...d, id]);
  const toggleCollapse = (id: string) =>
    setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const appliquer = () => { onChange(draft); setOpen(false); };

  const filtre = q.trim().toLowerCase();
  const match = (u: Uo) => !filtre || u.libelle.toLowerCase().includes(filtre) || (u.code || "").toLowerCase().includes(filtre);

  const renderNode = (u: Uo, depth: number): JSX.Element[] => {
    const kids = enfants[u.id] || [];
    const childRows = kids.flatMap(k => renderNode(k, depth + 1));
    if (filtre && !match(u) && childRows.length === 0) return [];
    const isOpen = !collapsed.has(u.id) || !!filtre;
    const rows: JSX.Element[] = [
      <div key={u.id} className="flex items-center gap-1 py-1 pr-2 rounded hover:bg-[hsl(var(--muted))]"
        style={{ paddingLeft: 6 + depth * 16 }}>
        {kids.length > 0 ? (
          <button type="button" onClick={() => toggleCollapse(u.id)} className="flex-shrink-0 opacity-60">
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : <span className="w-[14px] flex-shrink-0" />}
        <button type="button" onClick={() => toggle(u.id)} className="flex items-center justify-between gap-2 text-left text-sm flex-1 min-w-0">
          <span className="flex items-center gap-2 truncate">
            <span className="flex h-4 w-4 items-center justify-center rounded border flex-shrink-0"
              style={{
                borderColor: draft.includes(u.id) ? "hsl(var(--primary))" : "hsl(var(--border))",
                background: draft.includes(u.id) ? "hsl(var(--primary))" : "transparent",
              }}>
              {draft.includes(u.id) && <Check size={12} className="text-white" />}
            </span>
            <span className="truncate">{u.libelle}</span>
          </span>
          {u.code && <span className="text-[11px] opacity-50 flex-shrink-0">{u.code}</span>}
        </button>
      </div>,
    ];
    if (isOpen) rows.push(...childRows);
    return rows;
  };

  const label = selected.length === 0 ? "Toutes les UO"
    : selected.length === 1 ? (uos.find(u => u.id === selected[0])?.libelle || "1 UO")
    : `${selected.length} UO sélectionnées`;

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex h-10 w-full items-center justify-between rounded-md border px-3 text-sm"
        style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))" }}>
        <span className="flex items-center gap-1.5 truncate" style={{ color: selected.length ? "inherit" : "hsl(var(--muted-foreground))" }}>
          <Building2 size={14} className="opacity-60" /> {label}
        </span>
        <ChevronDown size={16} className="opacity-60 flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-[360px] rounded-md border shadow-lg"
          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
          <div className="flex items-center gap-2 border-b px-2 py-1.5" style={{ borderColor: "hsl(var(--border))" }}>
            <Search size={14} className="opacity-60" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher une UO…"
              className="w-full bg-transparent text-sm outline-none" />
          </div>

          <div className="flex items-center gap-3 px-3 py-1.5 border-b text-[12px]" style={{ borderColor: "hsl(var(--border))" }}>
            <button type="button" onClick={() => setDraft(uos.map(u => u.id))} style={{ color: "hsl(var(--primary))" }} className="font-medium">Tout sélectionner</button>
            <button type="button" onClick={() => setDraft([])} style={{ color: "hsl(var(--muted-foreground))" }}>Effacer</button>
          </div>

          <div className="max-h-72 overflow-auto p-1">
            {uos.length === 0
              ? <p className="px-3 py-2 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune UO.</p>
              : racines.flatMap(u => renderNode(u, 0))}
          </div>

          <div className="border-t p-2" style={{ borderColor: "hsl(var(--border))" }}>
            <button type="button" onClick={appliquer}
              className="w-full rounded-md py-1.5 text-sm font-medium text-white"
              style={{ background: "hsl(var(--primary))" }}>
              Appliquer
            </button>
          </div>
          <div className="px-3 pb-2 text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
            Cocher une UO inclut ses sous-UO.
          </div>
        </div>
      )}
    </div>
  );
}
