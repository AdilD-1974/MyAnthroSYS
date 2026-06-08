/**
 * FormattedInput – Input avec formatage automatique au blur.
 * Auteur : Adil DAIA
 *
 * Comportement :
 *  - Au focus : affiche la valeur brute (modifiable, ex: "40000.5")
 *  - Au blur : affiche la valeur formatée selon les masques (ex: "40 000,50")
 *  - Stocke et émet toujours la valeur numérique pure (pas la chaîne formatée)
 *
 * Types supportés :
 *  - "number"   : nombre simple
 *  - "currency" : nombre + symbole devise
 *  - "percent"  : nombre + " %"
 *  - "date"     : ISO YYYY-MM-DD ↔ format masque (input date natif)
 *  - "text"     : passe-plat
 *
 * Usage :
 *   <FormattedInput
 *     type="number"
 *     value={40000.5}
 *     onChange={(v) => setVal(v)}     // v est number
 *     placeholder="0,00"
 *   />
 */
import React, { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { useFormatMasks } from "@/hooks/useFormatMasks";

type FormatType = "number" | "currency" | "percent" | "date" | "text" | "boolean";

interface Props {
  type?: FormatType;
  value: number | string | boolean | null | undefined;
  onChange: (val: number | string | boolean | null) => void;
  decimales?: number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  step?: string;
  min?: number;
  max?: number;
  /** Si true, formate aussi pendant l'édition (utile en lecture seule) */
  alwaysFormat?: boolean;
}

const FormattedInput: React.FC<Props> = ({
  type = "number",
  value,
  onChange,
  decimales,
  placeholder,
  disabled,
  className,
  id,
  step,
  min,
  max,
  alwaysFormat,
}) => {
  const { formatNumber, formatDate, formatCurrency, formatPercent } = useFormatMasks();
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Cas BOOLEEN : checkbox
  if (type === "boolean") {
    return (
      <input
        type="checkbox"
        id={id}
        checked={!!value}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        className="rounded border-border text-accent"
      />
    );
  }

  // Cas DATE : input date natif (qui gère déjà l'affichage selon la locale)
  if (type === "date") {
    const isoVal = typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
      ? value.substring(0, 10)
      : (value ? String(value) : "");
    return (
      <Input
        type="date"
        id={id}
        value={isoVal}
        disabled={disabled}
        className={className}
        min="1950-01-01"
        max="2099-12-31"
        onChange={e => onChange(e.target.value || null)}
        placeholder={placeholder}
      />
    );
  }

  // Cas TEXT : passe-plat
  if (type === "text") {
    return (
      <Input
        type="text"
        id={id}
        value={value === null || value === undefined ? "" : String(value)}
        disabled={disabled}
        className={className}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value || null)}
      />
    );
  }

  // Cas NUMBER / CURRENCY / PERCENT
  // Affichage : si focus → brut ; sinon → formaté
  const displayValue = (() => {
    if (focused) return draft;
    if (value === null || value === undefined || value === "") return "";
    if (alwaysFormat) {
      if (type === "currency") return formatCurrency(value as number);
      if (type === "percent")  return formatPercent(value as number);
      return formatNumber(value as number, decimales);
    }
    // Au blur : affichage formaté
    if (type === "currency") return formatCurrency(value as number);
    if (type === "percent")  return formatPercent(value as number);
    return formatNumber(value as number, decimales);
  })();

  const handleFocus = () => {
    setFocused(true);
    // Initialiser le draft avec la valeur brute (sans formatage)
    if (value === null || value === undefined || value === "") {
      setDraft("");
    } else {
      setDraft(String(value));
    }
    // Sélectionner tout le contenu pour faciliter la modification
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraft(e.target.value);
  };

  const handleBlur = () => {
    setFocused(false);
    // Parser le draft : accepte "40000,5" ou "40000.5" ou "40 000,5"
    const cleaned = draft.replace(/\s/g, "").replace(",", ".");
    if (cleaned === "" || cleaned === "-") {
      onChange(null);
      return;
    }
    const n = parseFloat(cleaned);
    if (Number.isFinite(n)) {
      onChange(n);
    }
    // Si NaN on ne change rien → la valeur reste celle d'avant
  };

  return (
    <Input
      ref={inputRef}
      type={focused ? "text" : "text"}
      inputMode={type === "number" || type === "currency" || type === "percent" ? "decimal" : undefined}
      id={id}
      value={displayValue}
      disabled={disabled}
      className={className}
      placeholder={placeholder}
      onFocus={handleFocus}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
};

export default FormattedInput;
