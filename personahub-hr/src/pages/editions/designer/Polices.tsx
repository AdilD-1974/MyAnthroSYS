/**
 * Polices.tsx — Choix de la police d'un objet (RG-EDT-RENDU-02).
 * Auteur : Adil DAIA — lot 2 bis (17/10/2026)
 * La liste vient du serveur : 3 polices PDF standard + polices TrueType installées sur le
 * serveur (Windows, Linux, répertoire des polices de l'entreprise). Elles sont incorporées au PDF.
 */
import { useEffect, useState } from "react";
import { editionsApi, type PoliceEdition } from "@/lib/editionsApi";

let cache: Promise<PoliceEdition[]> | null = null;
const charger = () => (cache ??= editionsApi.polices().catch(() => { cache = null; return [] as PoliceEdition[]; }));

/** Police CSS approchante pour le canevas (le PDF, lui, utilise la vraie police du serveur). */
export function cssPolice(nom?: string | null): string {
  switch (nom ?? "Helvetica") {
    case "Helvetica": return "Helvetica, Arial, sans-serif";
    case "Times": return "'Times New Roman', Times, serif";
    case "Courier": return "'Courier New', Courier, monospace";
    default: return `'${nom}', Helvetica, Arial, sans-serif`;
  }
}

export function ChoixPolice({ value, onChange, disabled, vide = "Par défaut (Helvetica)" }: {
  value?: string | null; onChange: (v: string | null) => void; disabled?: boolean; vide?: string;
}) {
  const [polices, setPolices] = useState<PoliceEdition[] | null>(null);
  useEffect(() => { let actif = true; void charger().then((p) => { if (actif) setPolices(p); }); return () => { actif = false; }; }, []);
  const inconnue = value && polices && !polices.some((p) => p.nom === value);
  return (
    <select disabled={disabled} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}
      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" style={{ fontFamily: cssPolice(value) }}
      title={inconnue ? "Police absente de ce serveur : Helvetica sera utilisée" : undefined}>
      <option value="">{vide}</option>
      {inconnue && <option value={value!}>{value} (absente du serveur)</option>}
      {(["PDF", "TrueType"] as const).map((o) => {
        const liste = (polices ?? []).filter((p) => p.origine === o && !(o === "PDF" && p.nom === "Helvetica"));
        return liste.length ? (
          <optgroup key={o} label={o === "PDF" ? "Polices PDF standard" : "Polices du serveur"}>
            {liste.map((p) => (
              <option key={p.nom} value={p.nom} style={{ fontFamily: cssPolice(p.nom) }}>
                {p.nom}{!p.gras ? " (sans gras)" : ""}
              </option>
            ))}
          </optgroup>
        ) : null;
      })}
    </select>
  );
}
