// ============================================================
// DynamicForm.tsx — src/components/dynamic/DynamicForm.tsx
// Moteur de rendu de formulaire piloté par un schéma JSON.
// Le même schéma sera produit par le futur Form Designer / l'IA.
// Lecture/écriture via le client proxy supabase.from(...) (CRUD FastAPI).
// 100% tokens de thème (respecte Apparence).
// ============================================================

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Save, X, Loader2, User, Users, Home, FileText, Shield, Calendar,
  Heart, GraduationCap, Wallet, type LucideIcon,
} from "lucide-react";

// ─── Types du schéma (contrat designer ↔ moteur) ─────────────
export type FieldType = "text" | "number" | "date" | "boolean" | "select" | "textarea";

export interface FieldDef {
  id: string;
  source: string;                 // colonne de l'entité
  label: string;
  type: FieldType;
  largeur?: number;               // col-span (1..colonnes de la section)
  obligatoire?: boolean;
  placeholder?: string;
  aide?: string;
  options?: { value: string; label: string }[];          // select statique
  refTable?: string; refValueCol?: string; refLabelCol?: string;  // select sur référentiel
}

export interface SectionDef {
  id: string;
  titre: string;
  icone?: string;
  colonnes?: number;              // 1 | 2 | 3
  champs: FieldDef[];
}

export interface FormSchema {
  code: string;
  titre: string;
  entite: string;                 // table cible
  sections: SectionDef[];
}

const ICONES: Record<string, LucideIcon> = {
  User, Users, Home, FileText, Shield, Calendar, Heart, GraduationCap, Wallet,
};
const SectionIcone = ({ nom }: { nom?: string }) => {
  const Ic = (nom && ICONES[nom]) || User;
  return <Ic size={15} />;
};

interface Props {
  schema: FormSchema;
  recordId?: string;                       // si présent => édition
  defaults?: Record<string, any>;          // valeurs imposées (ex. collaborateur_id)
  onSaved?: (row: any) => void;
  onCancel?: () => void;
}

export default function DynamicForm({ schema, recordId, defaults, onSaved, onCancel }: Props) {
  const champs = useMemo(() => schema.sections.flatMap(s => s.champs), [schema]);
  const colonnesSource = useMemo(
    () => Array.from(new Set(["id", ...champs.map(c => c.source), ...Object.keys(defaults ?? {})])),
    [champs, defaults]
  );

  const [values, setValues] = useState<Record<string, any>>({});
  const [refsOptions, setRefsOptions] = useState<Record<string, { value: string; label: string }[]>>({});
  const [loading, setLoading] = useState(!!recordId);
  const [saving, setSaving] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  // Valeur initiale (édition : charge la ligne ; création : defaults)
  useEffect(() => {
    let actif = true;
    (async () => {
      if (recordId) {
        setLoading(true);
        const { data, error } = await supabase
          .from(schema.entite)
          .select(colonnesSource.join(","))
          .eq("id", recordId);
        if (!actif) return;
        if (error) setErreur(error.message);
        const row = Array.isArray(data) ? data[0] : data;
        setValues({ ...(row || {}), ...(defaults || {}) });
        setLoading(false);
      } else {
        setValues({ ...(defaults || {}) });
      }
    })();
    return () => { actif = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, schema.entite]);

  // Options des selects sur référentiel
  useEffect(() => {
    const aCharger = champs.filter(c => c.type === "select" && c.refTable && c.refValueCol && c.refLabelCol);
    aCharger.forEach(async c => {
      const { data } = await supabase
        .from(c.refTable!)
        .select(`${c.refValueCol},${c.refLabelCol}`);
      const opts = (data || []).map((r: any) => ({ value: r[c.refValueCol!], label: r[c.refLabelCol!] }));
      setRefsOptions(prev => ({ ...prev, [c.id]: opts }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema.code]);

  const set = (source: string, v: any) => setValues(prev => ({ ...prev, [source]: v }));

  const manquants = useMemo(
    () => champs.filter(c => c.obligatoire &&
      (values[c.source] === undefined || values[c.source] === null || values[c.source] === "")),
    [champs, values]
  );

  const enregistrer = async () => {
    setTouched(true);
    if (manquants.length > 0) { setErreur("Veuillez renseigner les champs obligatoires."); return; }
    setErreur(null); setSaving(true);
    try {
      // Ne renvoyer que les colonnes du schéma (+ defaults)
      const payload: Record<string, any> = { ...(defaults || {}) };
      champs.forEach(c => { payload[c.source] = values[c.source] ?? null; });

      let res;
      if (recordId) {
        res = await supabase.from(schema.entite).update(payload).eq("id", recordId).select(colonnesSource.join(","));
      } else {
        res = await supabase.from(schema.entite).insert(payload).select(colonnesSource.join(","));
      }
      if (res.error) throw new Error(res.error.message);
      const row = Array.isArray(res.data) ? res.data[0] : res.data;
      onSaved?.(row || payload);
    } catch (e: any) {
      setErreur(e.message || "Échec de l'enregistrement");
    } finally {
      setSaving(false);
    }
  };

  const champVide = (c: FieldDef) =>
    touched && c.obligatoire && (values[c.source] === undefined || values[c.source] === null || values[c.source] === "");

  const renderChamp = (c: FieldDef) => {
    const v = values[c.source];
    const base = "w-full px-3 py-2 rounded-lg text-sm outline-none transition-all";
    const style: React.CSSProperties = {
      background: "hsl(var(--background))",
      color: "hsl(var(--foreground))",
      border: `1px solid ${champVide(c) ? "hsl(var(--destructive))" : "hsl(var(--border))"}`,
    };

    if (c.type === "boolean") {
      return (
        <label className="flex items-center gap-2 cursor-pointer select-none" style={{ paddingTop: 6 }}>
          <input type="checkbox" checked={!!v} onChange={e => set(c.source, e.target.checked)}
            style={{ width: 16, height: 16, accentColor: "hsl(var(--primary))" }} />
          <span className="text-sm" style={{ color: "hsl(var(--foreground))" }}>{c.label}</span>
        </label>
      );
    }
    if (c.type === "select") {
      const opts = c.options ?? refsOptions[c.id] ?? [];
      return (
        <select className={base} style={style} value={v ?? ""} onChange={e => set(c.source, e.target.value || null)}>
          <option value="">—</option>
          {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    }
    if (c.type === "textarea") {
      return <textarea className={base} style={{ ...style, minHeight: 76, resize: "vertical" }}
        value={v ?? ""} placeholder={c.placeholder} onChange={e => set(c.source, e.target.value)} />;
    }
    return (
      <input
        type={c.type === "number" ? "number" : c.type === "date" ? "date" : "text"}
        className={base} style={style}
        value={v ?? ""} placeholder={c.placeholder}
        onChange={e => set(c.source, c.type === "number"
          ? (e.target.value === "" ? null : Number(e.target.value))
          : e.target.value)}
      />
    );
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
        <Loader2 size={15} className="animate-spin" /> Chargement…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {schema.sections.map(sec => {
        const cols = sec.colonnes ?? 2;
        return (
          <div key={sec.id} className="p-4 rounded-xl border space-y-3"
            style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.15)" }}>
            <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-2"
              style={{ color: "hsl(var(--primary))" }}>
              <SectionIcone nom={sec.icone} /> {sec.titre}
            </p>
            <div className="grid gap-x-4 gap-y-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
              {sec.champs.map(c => (
                <div key={c.id} style={{ gridColumn: `span ${Math.min(c.largeur ?? 1, cols)} / span ${Math.min(c.largeur ?? 1, cols)}` }}>
                  {c.type !== "boolean" && (
                    <label className="text-xs font-medium block mb-1" style={{ color: "hsl(var(--foreground))" }}>
                      {c.label}{c.obligatoire && <span style={{ color: "hsl(var(--destructive))" }}> *</span>}
                    </label>
                  )}
                  {renderChamp(c)}
                  {c.aide && <p className="text-[11px] mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>{c.aide}</p>}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {erreur && (
        <div className="px-4 py-2.5 rounded-lg text-sm" style={{ background: "hsl(var(--destructive) / 0.1)", color: "hsl(var(--destructive))" }}>
          {erreur}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        {onCancel && (
          <button onClick={onCancel} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
            style={{ border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))", background: "transparent" }}>
            <X size={15} /> Annuler
          </button>
        )}
        <button onClick={enregistrer} disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", opacity: saving ? 0.7 : 1 }}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {recordId ? "Enregistrer" : "Créer"}
        </button>
      </div>
    </div>
  );
}
