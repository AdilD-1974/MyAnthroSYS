/**
 * CollaborateurPicker.tsx
 * Auteur : Adil DAIA
 *
 * Sélecteur de collaborateur avec recherche (nom, prénom ou matricule).
 * Sans dépendance externe (pas de cmdk). Cache la liste au niveau module
 * pour éviter de la recharger à chaque usage.
 *
 *   <CollaborateurPicker value={id} onChange={setId} excludeId={moi} />
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ChevronDown, Check, Search } from "lucide-react";

interface Collab { id: string; nom: string; prenom: string; matricule?: string; }
interface Props {
  value: string;
  onChange: (id: string) => void;
  excludeId?: string;
  placeholder?: string;
  disabled?: boolean;
}

let _cache: Collab[] | null = null;

export default function CollaborateurPicker({
  value, onChange, excludeId, placeholder = "Choisir un collaborateur…", disabled,
}: Props) {
  const [collabs, setCollabs] = useState<Collab[]>(_cache || []);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (_cache) { setCollabs(_cache); return; }
    api.get(`/db/collaborateurs?statut_collaborateur=eq.ACTIF&select=id,nom,prenom,matricule&order=nom`)
      .then((r) => { _cache = r || []; setCollabs(_cache); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return collabs
      .filter((c) => c.id !== excludeId)
      .filter((c) => !t || `${c.nom} ${c.prenom} ${c.matricule || ""}`.toLowerCase().includes(t))
      .slice(0, 50);
  }, [collabs, q, excludeId]);

  const selected = collabs.find((c) => c.id === value);
  const label = (c?: Collab) => (c ? `${c.nom} ${c.prenom}${c.matricule ? " · " + c.matricule : ""}` : "");

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center justify-between rounded-md border px-3 text-sm disabled:opacity-50"
        style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))" }}
      >
        <span style={{ color: selected ? "inherit" : "hsl(var(--muted-foreground))" }}>
          {selected ? label(selected) : placeholder}
        </span>
        <ChevronDown size={16} className="opacity-60" />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-full rounded-md border shadow-lg"
          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
        >
          <div className="flex items-center gap-2 border-b px-2 py-1.5" style={{ borderColor: "hsl(var(--border))" }}>
            <Search size={14} className="opacity-60" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nom, prénom ou matricule…"
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
          <div className="max-h-64 overflow-auto py-1">
            {list.length === 0 ? (
              <p className="px-3 py-2 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun résultat.</p>
            ) : (
              list.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { onChange(c.id); setOpen(false); setQ(""); }}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-[hsl(var(--muted))]"
                >
                  <span>
                    {c.nom} {c.prenom}
                    {c.matricule && <span style={{ color: "hsl(var(--muted-foreground))" }}> · {c.matricule}</span>}
                  </span>
                  {c.id === value && <Check size={14} />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
