import React, { useState, useRef } from "react";
import { Search } from "lucide-react";
import { WfVariable } from "@/hooks/useWorkflowContent";

export const CAT_COLOR_VAR: Record<string, string> = {
  GENERAL: "#64748B", COLLABORATEUR: "#3B6FE4", DEMANDE: "#E07B39", CONTRAT: "#8B5CF6",
  PAIE: "#14B8A6", ORGANISATION: "#0EA5E9", WORKFLOW: "#DB2777",
};
export const varCatColor = (c: string) => CAT_COLOR_VAR[c] || "#64748B";

export const DONNEE_LABEL: Record<string, string> = {
  TEXTE: "Texte", NOMBRE: "Nombre", DATE: "Date", DATETIME: "Date + heure", BOOLEEN: "Booléen", MONTANT: "Montant",
};
export const CANAL_META: Record<string, { label: string; color: string }> = {
  EMAIL: { label: "Email", color: "#3B6FE4" }, SMS: { label: "SMS", color: "#14B8A6" },
  WHATSAPP: { label: "WhatsApp", color: "#16A34A" }, NOTIFICATION: { label: "Notification interne", color: "#8B5CF6" },
  PUSH: { label: "Push mobile", color: "#E07B39" },
};
export const DOC_META: Record<string, { label: string; color: string }> = {
  WORD: { label: "Word", color: "#2563EB" }, HTML: { label: "HTML", color: "#E07B39" },
  PDF: { label: "PDF", color: "#DC2626" }, TEXTE: { label: "Texte", color: "#64748B" },
};

// Hook d'insertion d'un jeton au curseur dans un input/textarea contrôlé
export function useInsert(value: string, onChange: (v: string) => void) {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const insert = (token: string) => {
    const el = ref.current;
    if (!el) { onChange((value || "") + token); return; }
    const s = el.selectionStart ?? value.length;
    const e = el.selectionEnd ?? value.length;
    const next = (value || "").slice(0, s) + token + (value || "").slice(e);
    onChange(next);
    requestAnimationFrame(() => { el.focus(); const pos = s + token.length; (el as any).setSelectionRange(pos, pos); });
  };
  return { ref, insert };
}

// Palette de variables : groupée par catégorie, recherche, filtre par objet métier
export const VariablePalette: React.FC<{ variables: WfVariable[]; typeObjet?: string | null; onInsert: (token: string) => void }> = ({ variables, typeObjet, onInsert }) => {
  const [q, setQ] = useState("");
  const ql = q.toLowerCase();
  let list = variables.filter((v) => v.actif);
  if (typeObjet && typeObjet !== "generique") list = list.filter((v) => !v.type_objet || v.type_objet === "generique" || v.type_objet === typeObjet);
  if (ql) list = list.filter((v) => v.code.toLowerCase().includes(ql) || v.libelle.toLowerCase().includes(ql));
  const byCat: Record<string, WfVariable[]> = {};
  list.forEach((v) => { (byCat[v.categorie] = byCat[v.categorie] || []).push(v); });
  return (
    <div className="rounded-xl border flex flex-col" style={{ borderColor: "hsl(var(--border))", maxHeight: "60vh" }}>
      <div className="p-2 border-b" style={{ borderColor: "hsl(var(--border))" }}>
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une variable…" className="h-8 w-full rounded-md border pl-7 pr-2 text-sm bg-background" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }} />
        </div>
        <p className="text-[10px] mt-1.5 px-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Cliquez pour insérer au curseur.</p>
      </div>
      <div className="overflow-auto p-2 space-y-3">
        {Object.keys(byCat).length === 0 && <p className="text-xs italic px-1" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune variable disponible.</p>}
        {Object.entries(byCat).map(([cat, vars]) => {
          const col = varCatColor(cat);
          return (
            <div key={cat}>
              <div className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: col }}>{cat}</div>
              <div className="flex flex-wrap gap-1">
                {vars.map((v) => (
                  <button key={v.id} type="button" onClick={() => onInsert(`{{${v.code}}}`)} title={`${v.code}${v.exemple_valeur ? " — ex: " + v.exemple_valeur : ""}`}
                    className="text-[11px] px-2 py-1 rounded-md border hover:shadow-sm transition-shadow" style={{ borderColor: col + "55", background: col + "12", color: col }}>
                    {v.libelle}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
